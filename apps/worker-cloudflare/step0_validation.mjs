#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";
import { MockD1Database, MockKVNamespace, MockQueue, signed_request } from "./test_support.mjs";

const REQUIRED_ZIG_VERSION = "0.15.2";

export class Step0PrerequisiteError extends Error {
  constructor(message) {
    super(message);
    this.name = "Step0PrerequisiteError";
  }
}

function resolve_zig_bin(env = process.env) {
  for (const key of ["NULLCLAW_ZIG_BIN", "ZIG"]) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "zig";
}

function format_spawn_failure(result) {
  const parts = [];

  if (typeof result.status === "number") {
    parts.push(`exit status ${result.status}`);
  }
  if (result.signal) {
    parts.push(`signal ${result.signal}`);
  }

  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";

  if (stderr.length > 0) {
    parts.push(`stderr: ${stderr}`);
  }
  if (stdout.length > 0) {
    parts.push(`stdout: ${stdout}`);
  }

  return parts.length > 0 ? parts.join("; ") : "no process output";
}

export function probe_step0_prerequisites(options = {}) {
  const env = options.env ?? process.env;
  const zig_bin = options.zig_bin ?? resolve_zig_bin(env);
  const probe = spawnSync(zig_bin, ["version"], { encoding: "utf8" });

  if (probe.error) {
    if (probe.error.code === "ENOENT") {
      return {
        available: false,
        zig_bin,
        reason:
          `Zig compiler not found (${zig_bin}). Install Zig ${REQUIRED_ZIG_VERSION} and ensure it is on PATH, or set NULLCLAW_ZIG_BIN to an absolute path.`,
      };
    }

    return {
      available: false,
      zig_bin,
      reason: `Unable to execute Zig compiler (${zig_bin}): ${probe.error.message}`,
    };
  }

  if (probe.status !== 0) {
    return {
      available: false,
      zig_bin,
      reason: `Zig prerequisite probe failed for ${zig_bin}: ${format_spawn_failure(probe)}`,
    };
  }

  return {
    available: true,
    zig_bin,
    detected_version: probe.stdout.trim(),
  };
}

function require_step0_prerequisites(options = {}) {
  const prerequisites = probe_step0_prerequisites(options);
  if (!prerequisites.available) {
    throw new Step0PrerequisiteError(
      `${prerequisites.reason} Step 0 runs locally with no network, but it does require Node.js plus Zig ${REQUIRED_ZIG_VERSION}.`,
    );
  }
  return prerequisites;
}

function run_executor_driver(repo_root, queue_message, options = {}) {
  const { zig_bin } = require_step0_prerequisites(options);
  const input_json = `${JSON.stringify(queue_message)}\n`;
  const result = spawnSync(zig_bin, ["run", "apps/executor/src/step0_validation_driver.zig"], {
    cwd: repo_root,
    input: input_json,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`executor_driver_spawn_failed (${zig_bin}): ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`executor_driver_failed (${zig_bin}): ${format_spawn_failure(result)}`);
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new Error(`executor_driver_failed (${zig_bin}): empty stdout`);
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`executor_driver_failed (${zig_bin}): invalid JSON output: ${reason}`);
  }
}

export async function run_step0_validation(options = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo_root = path.resolve(here, "../..");
  require_step0_prerequisites(options);

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

  const terminal_payload = run_executor_driver(repo_root, env.TASK_QUEUE.messages[0], options);
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
      if (error instanceof Step0PrerequisiteError) {
        console.error(error.message);
      } else {
        console.error(error instanceof Error ? error.stack : String(error));
      }
      process.exitCode = 1;
    });
}
