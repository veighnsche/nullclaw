import assert from "node:assert/strict";
import test from "node:test";
import {
  Step0PrerequisiteError,
  probe_step0_prerequisites,
  run_step0_validation,
} from "./step0_validation.mjs";

const prerequisites = probe_step0_prerequisites();

test("step0 deterministic validation path succeeds", {
  skip: prerequisites.available ? false : prerequisites.reason,
}, async () => {
  const summary = await run_step0_validation();
  assert.equal(summary.task_id, "task-step0");
  assert.equal(summary.final_status, "succeeded");
  assert.equal(summary.queue_messages, 1);
  assert.equal(summary.task_events, 1);
  assert.equal(summary.second_terminal_status, 409);
});

test("step0 validation reports missing zig clearly", async () => {
  await assert.rejects(
    run_step0_validation({ zig_bin: "/definitely-missing-zig" }),
    (error) => {
      assert.ok(error instanceof Step0PrerequisiteError);
      assert.match(error.message, /Zig compiler not found/);
      assert.match(error.message, /NULLCLAW_ZIG_BIN/);
      assert.match(error.message, /0\.15\.2/);
      return true;
    },
  );
});
