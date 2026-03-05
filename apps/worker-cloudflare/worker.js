import { compute_hmac_sha256_hex, timing_safe_equal_hex } from "./hmac.mjs";

const ONE_DAY_SECONDS = 24 * 60 * 60;
const QUEUED_STATUS = "queued";
const TERMINAL_STATUS_SUCCEEDED = "succeeded";
const TERMINAL_STATUS_FAILED = "failed";
const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);
const VALID_ACTION_TARGETS = new Set(["local", "external_account", "public_publish", "money"]);
const DEFAULT_DAILY_TASK_LIMIT = 50;
const DEFAULT_PER_MINUTE_TASK_LIMIT = 10;
const DEFAULT_MAX_PROMPT_BYTES = 4000;
const DEFAULT_FAILURES_BEFORE_COOLDOWN = 3;
const DEFAULT_FAILURE_COOLDOWN_SECONDS = 300;

function json_response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parse_inbound_payload(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid_payload");
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (prompt.length === 0) {
    throw new Error("missing_prompt");
  }

  const workflow =
    typeof payload.workflow === "string" && payload.workflow.trim().length > 0
      ? payload.workflow.trim()
      : "echo_summary";

  const requested_by =
    typeof payload.requested_by === "string" && payload.requested_by.trim().length > 0
      ? payload.requested_by.trim()
      : "unknown";

  const channel =
    typeof payload.channel === "string" && payload.channel.trim().length > 0
      ? payload.channel.trim()
      : "whatsapp";

  const risk_level =
    typeof payload.risk_level === "string" && payload.risk_level.trim().length > 0
      ? payload.risk_level.trim()
      : "low";
  if (!VALID_RISK_LEVELS.has(risk_level)) {
    throw new Error("invalid_risk_level");
  }

  const action_target =
    typeof payload.action_target === "string" && payload.action_target.trim().length > 0
      ? payload.action_target.trim()
      : "local";
  if (!VALID_ACTION_TARGETS.has(action_target)) {
    throw new Error("invalid_action_target");
  }

  const message_id = typeof payload.message_id === "string" ? payload.message_id.trim() : "";

  return {
    task_id: typeof payload.task_id === "string" && payload.task_id.trim().length > 0 ? payload.task_id.trim() : crypto.randomUUID(),
    message_id,
    workflow,
    prompt,
    requested_by,
    channel,
    risk_level,
    action_target,
  };
}

async function verify_signature(request, env) {
  if (!env.WHATSAPP_WEBHOOK_SECRET) {
    return true;
  }

  const provided = request.headers.get("x-nullclaw-signature");
  if (!provided) {
    return false;
  }

  const provided_parts = provided.split("=");
  if (provided_parts.length !== 2 || provided_parts[0] !== "sha256") {
    return false;
  }

  const body_text = await request.clone().text();
  const expected_hex = await compute_hmac_sha256_hex(env.WHATSAPP_WEBHOOK_SECRET, body_text);
  return timing_safe_equal_hex(provided_parts[1], expected_hex);
}

function read_positive_int_env(raw_value, fallback) {
  if (typeof raw_value !== "string" || raw_value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw_value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function daily_window_key(requested_by, now) {
  const day = now.toISOString().slice(0, 10);
  return `limit:daily:${requested_by}:${day}`;
}

function minute_window_key(requested_by, now) {
  const minute = now.toISOString().slice(0, 16);
  return `limit:minute:${requested_by}:${minute}`;
}

async function check_and_increment_sender_limits(env, requested_by) {
  const now = new Date();
  const daily_limit = read_positive_int_env(env.DAILY_TASK_LIMIT, DEFAULT_DAILY_TASK_LIMIT);
  const per_minute_limit = read_positive_int_env(env.PER_MINUTE_TASK_LIMIT, DEFAULT_PER_MINUTE_TASK_LIMIT);

  const daily_key = daily_window_key(requested_by, now);
  const minute_key = minute_window_key(requested_by, now);

  const daily_count_raw = await env.WHATSAPP_DEDUP.get(daily_key);
  const minute_count_raw = await env.WHATSAPP_DEDUP.get(minute_key);

  const daily_count = Number.parseInt(daily_count_raw ?? "0", 10) || 0;
  const minute_count = Number.parseInt(minute_count_raw ?? "0", 10) || 0;

  if (daily_count >= daily_limit) return "daily_task_limit_exceeded";
  if (minute_count >= per_minute_limit) return "sender_rate_limit_exceeded";

  await env.WHATSAPP_DEDUP.put(daily_key, `${daily_count + 1}`, { expirationTtl: 2 * ONE_DAY_SECONDS });
  await env.WHATSAPP_DEDUP.put(minute_key, `${minute_count + 1}`, { expirationTtl: 2 * 60 });
  return null;
}

function exceeds_prompt_size_limit(prompt, env) {
  const max_prompt_bytes = read_positive_int_env(env.MAX_PROMPT_BYTES, DEFAULT_MAX_PROMPT_BYTES);
  return new TextEncoder().encode(prompt).length > max_prompt_bytes;
}

async function is_sender_in_cooldown(env, requested_by) {
  const value = await env.WHATSAPP_DEDUP.get(`cooldown:${requested_by}`);
  return value !== null;
}

async function maybe_apply_failure_cooldown(env, terminal) {
  if (terminal.terminal_status !== TERMINAL_STATUS_FAILED) return;

  const failure_threshold = read_positive_int_env(env.FAILURES_BEFORE_COOLDOWN, DEFAULT_FAILURES_BEFORE_COOLDOWN);
  const cooldown_seconds = read_positive_int_env(env.FAILURE_COOLDOWN_SECONDS, DEFAULT_FAILURE_COOLDOWN_SECONDS);
  const failure_key = `failures:recent:${terminal.requested_by}`;
  const cooldown_key = `cooldown:${terminal.requested_by}`;

  const current_failures_raw = await env.WHATSAPP_DEDUP.get(failure_key);
  const current_failures = Number.parseInt(current_failures_raw ?? "0", 10) || 0;
  const next_failures = current_failures + 1;

  await env.WHATSAPP_DEDUP.put(failure_key, `${next_failures}`, { expirationTtl: 60 * 60 });
  if (next_failures >= failure_threshold) {
    await env.WHATSAPP_DEDUP.put(cooldown_key, "1", { expirationTtl: cooldown_seconds });
  }
}

async function is_duplicate_message(kv, message_id) {
  if (!message_id) {
    return false;
  }

  const key = `message:${message_id}`;
  const existing = await kv.get(key);
  return existing !== null;
}

async function mark_message_id_processed(kv, message_id) {
  if (!message_id) {
    return;
  }
  const key = `message:${message_id}`;
  await kv.put(key, "1", { expirationTtl: ONE_DAY_SECONDS });
}

async function mark_enqueue_failure(db, task_id, failure_reason) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'failed', updated_at = ?1, last_error = ?2, version = version + 1
       WHERE id = ?3`,
    )
    .bind(now, failure_reason, task_id)
    .run();
}

async function insert_queued_task(db, task) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tasks (
        id,
        status,
        workflow,
        risk_level,
        action_target,
        requested_by,
        channel,
        prompt,
        attempts,
        created_at,
        updated_at,
        version
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9, 0)`,
    )
    .bind(
      task.task_id,
      QUEUED_STATUS,
      task.workflow,
      task.risk_level,
      task.action_target,
      task.requested_by,
      task.channel,
      task.prompt,
      now,
    )
    .run();
}

async function enqueue_task(queue, task) {
  await queue.send({
    task_id: task.task_id,
    workflow: task.workflow,
    prompt: task.prompt,
    requested_by: task.requested_by,
    channel: task.channel,
    attempts: 0,
  });
}

function parse_terminal_payload(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid_payload");
  }

  const task_id = typeof payload.task_id === "string" ? payload.task_id.trim() : "";
  const requested_by = typeof payload.requested_by === "string" ? payload.requested_by.trim() : "";
  const terminal_status = typeof payload.terminal_status === "string" ? payload.terminal_status.trim() : "";
  const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";

  if (task_id.length === 0) throw new Error("missing_task_id");
  if (requested_by.length === 0) throw new Error("missing_requested_by");
  if (summary.length === 0) throw new Error("missing_summary");
  if (terminal_status !== TERMINAL_STATUS_SUCCEEDED && terminal_status !== TERMINAL_STATUS_FAILED) {
    throw new Error("invalid_terminal_status");
  }

  return {
    task_id,
    requested_by,
    terminal_status,
    summary,
  };
}

function format_terminal_message(terminal_status, summary) {
  if (terminal_status === TERMINAL_STATUS_SUCCEEDED) {
    return `Gelukt: ${summary}`;
  }
  return `Niet gelukt, dit is geprobeerd: ${summary}`;
}

async function append_terminal_event(db, terminal) {
  const now = new Date().toISOString();
  const update_result = await db
    .prepare(
      `UPDATE tasks
       SET status = ?1, updated_at = ?2, version = version + 1
       WHERE id = ?3 AND status IN ('queued', 'running', 'waiting_approval')`,
    )
    .bind(terminal.terminal_status, now, terminal.task_id)
    .run();

  const changed_rows = update_result?.meta?.changes ?? update_result?.changes ?? 0;
  if (changed_rows !== 1) {
    throw new Error("invalid_terminal_transition");
  }

  await db
    .prepare(
      `INSERT INTO task_events (task_id, event_type, event_payload_json, created_at)
       VALUES (?1, 'terminal_update', ?2, ?3)`,
    )
    .bind(
      terminal.task_id,
      JSON.stringify({
        requested_by: terminal.requested_by,
        terminal_status: terminal.terminal_status,
        summary: terminal.summary,
      }),
      now,
    )
    .run();
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json_response(405, { error: "method_not_allowed" });
    }

    if (!(await verify_signature(request, env))) {
      return json_response(401, { error: "signature_mismatch" });
    }

    const url = new URL(request.url);

    if (url.pathname === "/terminal") {
      let terminal;
      try {
        terminal = parse_terminal_payload(await request.json());
      } catch (error) {
        return json_response(400, {
          error: error instanceof Error ? error.message : "invalid_payload",
        });
      }

      try {
        await append_terminal_event(env.TASKS_DB, terminal);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "terminal_update_failed";
        if (reason === "invalid_terminal_transition") {
          return json_response(409, { error: reason, task_id: terminal.task_id });
        }
        return json_response(500, { error: reason, task_id: terminal.task_id });
      }

      const message_text = format_terminal_message(terminal.terminal_status, terminal.summary);
      await maybe_apply_failure_cooldown(env, terminal);
      return json_response(200, {
        status: "terminal_recorded",
        task_id: terminal.task_id,
        requested_by: terminal.requested_by,
        message_text,
      });
    }

    let parsed;
    try {
      parsed = parse_inbound_payload(await request.json());
    } catch (error) {
      return json_response(400, {
        error: error instanceof Error ? error.message : "invalid_payload",
      });
    }

    const duplicate = await is_duplicate_message(env.WHATSAPP_DEDUP, parsed.message_id);
    if (duplicate) {
      return json_response(200, { status: "duplicate_ignored", message_id: parsed.message_id });
    }

    if (await is_sender_in_cooldown(env, parsed.requested_by)) {
      return json_response(429, {
        error: "sender_cooldown_active",
        requested_by: parsed.requested_by,
      });
    }

    if (exceeds_prompt_size_limit(parsed.prompt, env)) {
      return json_response(413, {
        error: "prompt_too_large",
        max_prompt_bytes: read_positive_int_env(env.MAX_PROMPT_BYTES, DEFAULT_MAX_PROMPT_BYTES),
      });
    }

    const limit_error = await check_and_increment_sender_limits(env, parsed.requested_by);
    if (limit_error) {
      return json_response(429, {
        error: limit_error,
        requested_by: parsed.requested_by,
      });
    }

    await insert_queued_task(env.TASKS_DB, parsed);
    try {
      await enqueue_task(env.TASK_QUEUE, parsed);
    } catch (_error) {
      await mark_enqueue_failure(env.TASKS_DB, parsed.task_id, "queue_enqueue_failed");
      return json_response(500, {
        error: "queue_enqueue_failed",
        task_id: parsed.task_id,
      });
    }

    await mark_message_id_processed(env.WHATSAPP_DEDUP, parsed.message_id);

    return json_response(200, {
      status: "queued",
      task_id: parsed.task_id,
    });
  },
};
