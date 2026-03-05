#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";

const TERMINAL_ALLOWED_FROM_STATES = new Set(["queued", "running", "waiting_approval"]);

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
      if (this.db.tasks.has(id)) {
        throw new Error("constraint_failed_tasks_id");
      }
      this.db.tasks.set(id, {
        id,
        status,
        workflow,
        risk_level,
        action_target,
        requested_by,
        channel,
        prompt,
        attempts: 0,
        created_at: now,
        updated_at: now,
        last_error: null,
        version: 0,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (normalized.startsWith("update tasks set status = 'failed'")) {
      const [now, reason, task_id] = this.args;
      const row = this.db.tasks.get(task_id);
      if (!row) throw new Error("missing_task");
      row.status = "failed";
      row.updated_at = now;
      row.last_error = reason;
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

    if (normalized.startsWith("update tasks set status = ?1")) {
      const [status, now, task_id] = this.args;
      const row = this.db.tasks.get(task_id);
      if (!row) return { success: true, meta: { changes: 0 } };
      if (!TERMINAL_ALLOWED_FROM_STATES.has(row.status)) {
        return { success: true, meta: { changes: 0 } };
      }
      row.status = status;
      row.updated_at = now;
      row.version += 1;
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

async function signed_request(pathname, payload, secret) {
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

function run_executor_driver(repo_root, queue_message) {
  const input_json = `${JSON.stringify(queue_message)}\n`;
  const result = spawnSync("zig", ["run", "apps/executor/src/step0_validation_driver.zig"], {
    cwd: repo_root,
    input: input_json,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`executor_driver_failed: ${result.stderr || result.stdout}`);
  }

  const output = result.stdout.trim();
  return JSON.parse(output);
}

export async function run_step0_validation() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo_root = path.resolve(here, "../..");

  const WHATSAPP_WEBHOOK_SECRET = "step0-secret";
  const env = {
    WHATSAPP_WEBHOOK_SECRET,
    WHATSAPP_DEDUP: new MockKVNamespace(),
    TASKS_DB: new MockD1Database(),
    TASK_QUEUE: new MockQueue(),
  };

  const ingest_payload = {
    task_id: "task-step0",
    message_id: "msg-step0-0001",
    workflow: "echo_summary",
    prompt: "  hello deterministic  ",
    requested_by: "rodger",
    channel: "whatsapp",
    risk_level: "low",
    action_target: "local",
  };

  const ingest_response = await worker.fetch(
    await signed_request("/", ingest_payload, WHATSAPP_WEBHOOK_SECRET),
    env,
  );
  assert.equal(ingest_response.status, 200);
  const ingest_body = await ingest_response.json();
  assert.equal(ingest_body.status, "queued");
  assert.equal(ingest_body.task_id, "task-step0");

  const task_row = env.TASKS_DB.tasks.get("task-step0");
  assert.ok(task_row);
  assert.equal(task_row.status, "queued");
  assert.equal(env.TASK_QUEUE.messages.length, 1);

  const duplicate_response = await worker.fetch(
    await signed_request("/", ingest_payload, WHATSAPP_WEBHOOK_SECRET),
    env,
  );
  assert.equal(duplicate_response.status, 200);
  const duplicate_body = await duplicate_response.json();
  assert.equal(duplicate_body.status, "duplicate_ignored");
  assert.equal(env.TASK_QUEUE.messages.length, 1);

  const terminal_payload = run_executor_driver(repo_root, env.TASK_QUEUE.messages[0]);
  assert.equal(terminal_payload.task_id, "task-step0");
  assert.equal(terminal_payload.requested_by, "rodger");
  assert.equal(terminal_payload.terminal_status, "succeeded");
  assert.equal(terminal_payload.summary, "hello deterministic");

  const terminal_response = await worker.fetch(
    await signed_request("/terminal", terminal_payload, WHATSAPP_WEBHOOK_SECRET),
    env,
  );
  assert.equal(terminal_response.status, 200);
  const terminal_body = await terminal_response.json();
  assert.equal(terminal_body.status, "terminal_recorded");
  assert.equal(terminal_body.task_id, "task-step0");
  assert.equal(terminal_body.message_text, "Gelukt: hello deterministic");

  const final_row = env.TASKS_DB.tasks.get("task-step0");
  assert.equal(final_row.status, "succeeded");
  assert.equal(final_row.version, 1);
  assert.equal(env.TASKS_DB.task_events.length, 1);

  const second_terminal_response = await worker.fetch(
    await signed_request("/terminal", terminal_payload, WHATSAPP_WEBHOOK_SECRET),
    env,
  );
  assert.equal(second_terminal_response.status, 409);
  const second_terminal_body = await second_terminal_response.json();
  assert.equal(second_terminal_body.error, "invalid_terminal_transition");

  return {
    task_id: final_row.id,
    final_status: final_row.status,
    queue_messages: env.TASK_QUEUE.messages.length,
    task_events: env.TASKS_DB.task_events.length,
    second_terminal_status: second_terminal_response.status,
  };
}

const is_main_module =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (is_main_module) {
  run_step0_validation()
    .then((summary) => {
      console.log("step0 validation passed");
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      console.error("step0 validation failed");
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
