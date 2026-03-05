import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";

class MockKVNamespace {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async put(key, value, _options) {
    this.values.set(key, value);
  }
}

class MockQueue {
  constructor() {
    this.messages = [];
  }

  async send(message) {
    this.messages.push(JSON.parse(JSON.stringify(message)));
  }
}

class MockD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    const normalized = this.sql.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.startsWith("insert into tasks (")) {
      const [id, status, workflow, risk_level, action_target, requested_by, channel, prompt, now] = this.args;
      this.db.tasks.set(id, {
        id,
        status,
        workflow,
        risk_level,
        action_target,
        requested_by,
        channel,
        prompt,
        created_at: now,
        updated_at: now,
        version: 0,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.startsWith("update tasks set status = ?1")) {
      const [status, now, task_id] = this.args;
      const row = this.db.tasks.get(task_id);
      if (!row) return { success: true, meta: { changes: 0 } };
      if (!new Set(["queued", "running", "waiting_approval"]).has(row.status)) {
        return { success: true, meta: { changes: 0 } };
      }
      row.status = status;
      row.updated_at = now;
      row.version += 1;
      return { success: true, meta: { changes: 1 } };
    }
    if (normalized.startsWith("insert into task_events")) {
      const [task_id, event_payload_json, created_at] = this.args;
      this.db.task_events.push({
        task_id,
        event_type: "terminal_update",
        event_payload_json,
        created_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`unsupported_sql:${normalized}`);
  }
}

class MockD1Database {
  constructor() {
    this.tasks = new Map();
    this.task_events = [];
  }

  prepare(sql) {
    return new MockD1Statement(this, sql);
  }
}

async function compute_hmac_sha256_hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function signed_request(payload, secret, pathname = "/") {
  const body = JSON.stringify(payload);
  const signature = await compute_hmac_sha256_hex(secret, body);
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nullclaw-signature": `sha256=${signature}`,
    },
    body,
  });
}

test("worker blocks sender after per-minute limit", async () => {
  const secret = "guardrails-secret";
  const env = {
    WHATSAPP_WEBHOOK_SECRET: secret,
    DAILY_TASK_LIMIT: "50",
    PER_MINUTE_TASK_LIMIT: "2",
    WHATSAPP_DEDUP: new MockKVNamespace(),
    TASKS_DB: new MockD1Database(),
    TASK_QUEUE: new MockQueue(),
  };

  const base_payload = {
    workflow: "echo_summary",
    prompt: "hello",
    requested_by: "rodger",
    channel: "whatsapp",
    risk_level: "low",
    action_target: "local",
  };

  const req1 = await signed_request({ ...base_payload, task_id: "task-1", message_id: "msg-1" }, secret);
  const res1 = await worker.fetch(req1, env);
  assert.equal(res1.status, 200);

  const req2 = await signed_request({ ...base_payload, task_id: "task-2", message_id: "msg-2" }, secret);
  const res2 = await worker.fetch(req2, env);
  assert.equal(res2.status, 200);

  const req3 = await signed_request({ ...base_payload, task_id: "task-3", message_id: "msg-3" }, secret);
  const res3 = await worker.fetch(req3, env);
  assert.equal(res3.status, 429);
  const body3 = await res3.json();
  assert.equal(body3.error, "sender_rate_limit_exceeded");
  assert.equal(env.TASK_QUEUE.messages.length, 2);
});

test("worker rejects oversized prompt before queue handoff", async () => {
  const secret = "guardrails-secret";
  const env = {
    WHATSAPP_WEBHOOK_SECRET: secret,
    MAX_PROMPT_BYTES: "8",
    WHATSAPP_DEDUP: new MockKVNamespace(),
    TASKS_DB: new MockD1Database(),
    TASK_QUEUE: new MockQueue(),
  };

  const payload = {
    task_id: "task-oversize",
    message_id: "msg-oversize",
    workflow: "echo_summary",
    prompt: "this prompt is too large",
    requested_by: "rodger",
    channel: "whatsapp",
    risk_level: "low",
    action_target: "local",
  };

  const request = await signed_request(payload, secret);
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error, "prompt_too_large");
  assert.equal(body.max_prompt_bytes, 8);
  assert.equal(env.TASK_QUEUE.messages.length, 0);
});

test("worker applies sender cooldown after repeated terminal failures", async () => {
  const secret = "guardrails-secret";
  const env = {
    WHATSAPP_WEBHOOK_SECRET: secret,
    FAILURES_BEFORE_COOLDOWN: "1",
    FAILURE_COOLDOWN_SECONDS: "600",
    WHATSAPP_DEDUP: new MockKVNamespace(),
    TASKS_DB: new MockD1Database(),
    TASK_QUEUE: new MockQueue(),
  };

  const ingest_payload = {
    task_id: "task-cooldown-1",
    message_id: "msg-cooldown-1",
    workflow: "echo_summary",
    prompt: "hello",
    requested_by: "rodger",
    channel: "whatsapp",
    risk_level: "low",
    action_target: "local",
  };

  const ingest_response = await worker.fetch(await signed_request(ingest_payload, secret), env);
  assert.equal(ingest_response.status, 200);

  const terminal_payload = {
    task_id: "task-cooldown-1",
    requested_by: "rodger",
    terminal_status: "failed",
    summary: "provider timeout",
  };
  const terminal_response = await worker.fetch(
    await signed_request(terminal_payload, secret, "/terminal"),
    env,
  );
  assert.equal(terminal_response.status, 200);

  const second_ingest = {
    ...ingest_payload,
    task_id: "task-cooldown-2",
    message_id: "msg-cooldown-2",
  };
  const blocked_response = await worker.fetch(await signed_request(second_ingest, secret), env);
  assert.equal(blocked_response.status, 429);
  const blocked_body = await blocked_response.json();
  assert.equal(blocked_body.error, "sender_cooldown_active");
  assert.equal(env.TASK_QUEUE.messages.length, 1);
});
