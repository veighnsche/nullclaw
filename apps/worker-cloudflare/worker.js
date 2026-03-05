const ONE_DAY_SECONDS = 24 * 60 * 60;
const QUEUED_STATUS = "queued";
const TERMINAL_STATUS_SUCCEEDED = "succeeded";
const TERMINAL_STATUS_FAILED = "failed";

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

  const action_target =
    typeof payload.action_target === "string" && payload.action_target.trim().length > 0
      ? payload.action_target.trim()
      : "local";

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

  return provided === env.WHATSAPP_WEBHOOK_SECRET;
}

async function remember_message_id(kv, message_id) {
  if (!message_id) {
    return false;
  }

  const key = `message:${message_id}`;
  const existing = await kv.get(key);
  if (existing !== null) {
    return true;
  }

  await kv.put(key, "1", { expirationTtl: ONE_DAY_SECONDS });
  return false;
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

  await db
    .prepare(
      `UPDATE tasks
       SET status = ?1, updated_at = ?2, version = version + 1
       WHERE id = ?3`,
    )
    .bind(terminal.terminal_status, now, terminal.task_id)
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

      await append_terminal_event(env.TASKS_DB, terminal);

      const message_text = format_terminal_message(terminal.terminal_status, terminal.summary);
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

    const duplicate = await remember_message_id(env.WHATSAPP_DEDUP, parsed.message_id);
    if (duplicate) {
      return json_response(200, { status: "duplicate_ignored", message_id: parsed.message_id });
    }

    await insert_queued_task(env.TASKS_DB, parsed);
    await enqueue_task(env.TASK_QUEUE, parsed);

    return json_response(200, {
      status: "queued",
      task_id: parsed.task_id,
    });
  },
};
