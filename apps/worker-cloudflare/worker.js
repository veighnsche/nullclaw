const ONE_DAY_SECONDS = 24 * 60 * 60;
const QUEUED_STATUS = "queued";

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

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json_response(405, { error: "method_not_allowed" });
    }

    if (!(await verify_signature(request, env))) {
      return json_response(401, { error: "signature_mismatch" });
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
