#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";
import { MockD1Database, MockKVNamespace, MockQueue, signed_request } from "./test_support.mjs";

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
