import assert from "node:assert/strict";
import test from "node:test";
import { run_step0_validation } from "./step0_validation.mjs";

test("step0 deterministic validation path succeeds", async () => {
  const summary = await run_step0_validation();
  assert.equal(summary.task_id, "task-step0");
  assert.equal(summary.final_status, "succeeded");
  assert.equal(summary.queue_messages, 1);
  assert.equal(summary.task_events, 1);
  assert.equal(summary.second_terminal_status, 409);
});
