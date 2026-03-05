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
    throw new Error(`unsupported_sql:${normalized}`);
  }
}

class MockD1Database {
  constructor() {
    this.tasks = new Map();
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

async function signed_request(payload, secret) {
  const body = JSON.stringify(payload);
  const signature = await compute_hmac_sha256_hex(secret, body);
  return new Request("https://example.test/", {
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
