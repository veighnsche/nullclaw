import { compute_hmac_sha256_hex } from "./hmac.mjs";

const TERMINAL_ALLOWED_FROM_STATES = new Set(["queued", "running", "waiting_approval"]);

export class MockKVNamespace {
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

export class MockQueue {
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

export class MockD1Database {
  constructor() {
    this.tasks = new Map();
    this.task_events = [];
  }

  prepare(sql) {
    return new MockD1Statement(this, sql);
  }
}

export async function signed_request(pathname, payload, secret) {
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
