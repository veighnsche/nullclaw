import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";
import { MockD1Database, MockKVNamespace, MockQueue, signed_request } from "./test_support.mjs";

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

  const req1 = await signed_request("/", { ...base_payload, task_id: "task-1", message_id: "msg-1" }, secret);
  const res1 = await worker.fetch(req1, env);
  assert.equal(res1.status, 200);

  const req2 = await signed_request("/", { ...base_payload, task_id: "task-2", message_id: "msg-2" }, secret);
  const res2 = await worker.fetch(req2, env);
  assert.equal(res2.status, 200);

  const req3 = await signed_request("/", { ...base_payload, task_id: "task-3", message_id: "msg-3" }, secret);
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

  const request = await signed_request("/", payload, secret);
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

  const ingest_response = await worker.fetch(await signed_request("/", ingest_payload, secret), env);
  assert.equal(ingest_response.status, 200);

  const terminal_payload = {
    task_id: "task-cooldown-1",
    requested_by: "rodger",
    terminal_status: "failed",
    summary: "provider timeout",
  };
  const terminal_response = await worker.fetch(
    await signed_request("/terminal", terminal_payload, secret),
    env,
  );
  assert.equal(terminal_response.status, 200);

  const second_ingest = {
    ...ingest_payload,
    task_id: "task-cooldown-2",
    message_id: "msg-cooldown-2",
  };
  const blocked_response = await worker.fetch(await signed_request("/", second_ingest, secret), env);
  assert.equal(blocked_response.status, 429);
  const blocked_body = await blocked_response.json();
  assert.equal(blocked_body.error, "sender_cooldown_active");
  assert.equal(env.TASK_QUEUE.messages.length, 1);
});

test("worker enforces daily sender budget cap", async () => {
  const secret = "guardrails-secret";
  const env = {
    WHATSAPP_WEBHOOK_SECRET: secret,
    DAILY_COST_BUDGET_CENTS: "10",
    WHATSAPP_DEDUP: new MockKVNamespace(),
    TASKS_DB: new MockD1Database(),
    TASK_QUEUE: new MockQueue(),
  };

  const payload_a = {
    task_id: "task-budget-1",
    message_id: "msg-budget-1",
    workflow: "echo_summary",
    prompt: "hello",
    requested_by: "rodger",
    channel: "whatsapp",
    risk_level: "low",
    action_target: "local",
    estimated_cost_cents: 6,
  };
  const payload_b = {
    ...payload_a,
    task_id: "task-budget-2",
    message_id: "msg-budget-2",
    estimated_cost_cents: 5,
  };

  const first = await worker.fetch(await signed_request("/", payload_a, secret), env);
  assert.equal(first.status, 200);

  const second = await worker.fetch(await signed_request("/", payload_b, secret), env);
  assert.equal(second.status, 429);
  const body = await second.json();
  assert.equal(body.error, "daily_budget_exceeded");
  assert.equal(env.TASK_QUEUE.messages.length, 1);
});
