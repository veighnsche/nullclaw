# rodger canary checklist

Status: execution checklist (March 5, 2026)

This file is the Rodger rollout source of truth.

Rules:
- execute in PR order
- do not start a later PR until the current PR acceptance criteria are green
- keep external side effects disabled until the Rodger canary is stable

Track:
- queue lag
- task success rate
- approval latency
- error classes by workflow
- cost per successful task

## Current repo status

Done in code:
- [x] D1 task ledger migration exists.
- [x] Worker scaffold exists for Queue + D1 + KV bindings.
- [x] Worker inserts queued tasks and appends terminal events.
- [x] Zig edge helpers exist for approval parsing, queue validation, and task status transitions.
- [x] `echo_summary` exists as the one implemented low-risk workflow.
- [x] Step 0 validation has been re-verified on Zig `0.15.2`.
- [x] Executor main process can consume one queue payload and emit or POST a signed terminal callback payload.
- [x] Guardrails exist for signature verification, rate limits, budget caps, prompt size, token estimate limits, and failure cooldowns.

Partial or blocked:
- [ ] `social_draft_and_approve` now reaches real `waiting_approval` state with persisted draft details, but chat re-entry is not wired yet.
- [ ] The workflow contract is only partially implemented; current workflow dispatch is still mostly `workflow + prompt -> terminal summary`.

Not started:
- [ ] Worker is not deployed with real production bindings.
- [ ] Executor is not deployed and reachable from the edge callback path.
- [ ] Real webhook signature secret is not configured.
- [ ] Rodger-only friend canary has not started.
- [ ] `keynote_pdf_pack`, `reservation_call_assistant`, and `music_generate_and_release` remain explicit scaffolds only.

## PR sequence

### PR 1 - restore deterministic Step 0 verification

Goal:
- make the local no-network Step 0 path trustworthy again

Target files:
- `apps/worker-cloudflare/step0_validation.mjs`
- `apps/worker-cloudflare/step0_validation.test.mjs`
- `apps/executor/src/step0_validation_driver.zig`
- `apps/worker-cloudflare/README.md`

Checklist:
- [x] make `node --test apps/worker-cloudflare/step0_validation.test.mjs` pass on the expected dev machine
- [x] fail clearly when `zig` is unavailable, instead of surfacing `executor_driver_failed: undefined`
- [x] confirm the validation still covers: queued row, queue handoff, executor run, terminal callback, one terminal event, duplicate terminal rejection
- [x] document the exact local prerequisites for running Step 0

Acceptance:
- `node --test apps/worker-cloudflare/step0_validation.test.mjs`
- no network access required

Current status:
- the missing-Zig failure mode is fixed and covered by a Node test
- the success-path acceptance has been re-verified on Zig `0.15.2`

### PR 2 - turn executor scaffold into a real service

Goal:
- replace the stub executor entrypoint with a service that can consume queue work and send terminal callbacks

Target files:
- `apps/executor/src/main.zig`
- `apps/executor/src/queue_consumer.zig`
- `apps/executor/src/task_runner.zig`
- `apps/executor/src/notify/whatsapp_terminal_notifier.zig`
- `apps/executor/README.md`

Checklist:
- [x] replace the stub `main()` with real startup logic
- [x] wire queue payload -> consume_once -> terminal callback request
- [x] move task lifecycle through `queued -> running -> terminal`
- [x] keep retry and attempt limits enforced in the executor path
- [x] add tests for service startup failure paths and terminal payload formatting

Acceptance:
- executor can be started locally as a process
- local run can consume one `echo_summary` queue payload and produce a valid terminal callback payload

Current status:
- executor main has replaced the stub entrypoint
- local one-shot run produces a valid worker `/terminal` payload

### PR 3 - deploy the thin edge and executor plumbing

Goal:
- align local Wrangler config with the real dual-Worker deployment and update both existing Worker instances safely
- keep Rodger explicitly non-live until secrets are provisioned

Target files:
- `apps/worker-cloudflare/wrangler.toml`
- `apps/worker-cloudflare/README.md`
- `apps/worker-cloudflare/wrangler_discovery_dump.md`
- `apps/worker-cloudflare/wrangler_workflow_actual.md`
- any deploy notes added by this PR

Checklist:
- [x] pin the real Cloudflare account in local Wrangler workflow so non-interactive commands do not guess
- [x] replace the placeholder single-worker local name with a deployment model that matches both live Workers:
  - `nullclaw-edge-whatsapp`
  - `nullclaw-edge-whatsapp-rodger`
- [ ] verify live binding parity for both Worker instances before deploying code changes
- current live mismatch:
  - Vince Worker has WhatsApp/OpenAI secrets configured
  - Rodger Worker currently has no secrets configured
- [x] document the exact update command sequence for both Worker instances
- [ ] deploy the same source program to both existing Worker names via Wrangler
- [ ] manually verify Vince still responds correctly after the update
- [ ] confirm Rodger remains explicitly non-live after the update
- [ ] decide explicitly whether D1 + Queue migration belongs in this PR or a later one

Acceptance:
- both Worker instances are updated through Wrangler from the same source program
- Vince remains the only live secret-backed instance
- Rodger remains explicitly non-live
- local deployment docs match the real two-Worker topology
- no one-worker assumptions remain in the rollout checklist

### PR 4 - implement a real approval lifecycle for `social_draft_and_approve`

Goal:
- make approval-required work pause in `waiting_approval` instead of returning immediate terminal success

Target files:
- `apps/executor/src/workflows/social_draft_and_approve.zig`
- `apps/executor/src/workflows/root.zig`
- `src/edge/contracts.zig`
- `src/edge/approval_command.zig`
- any worker/executor files needed for approval-state persistence

Checklist:
- [x] return `waiting_approval` for draft creation instead of terminal `succeeded`
- [x] persist draft summary and approval state in the ledger/event flow
- [x] route approve, reject, and revise through the Zig approval parser
- [ ] keep external publish side effects disabled
- [x] add deterministic tests for `waiting_approval -> queued`, `waiting_approval -> canceled`, and revise flow

Acceptance:
- a social draft task can pause, accept an approval command, and resume without external publish side effects

Current status:
- executor returns `waiting_approval` for `social_draft_and_approve`
- worker persists `waiting_approval` callbacks and draft details in `task_events`
- Zig approval helper covers approve, reject, and revise transitions deterministically
- inbound user approval messages are not wired to this helper yet

### PR 5 - internal canary

Goal:
- prove the low-risk path is stable before Rodger sees it

Checklist:
- [ ] run `node --test apps/worker-cloudflare/step0_validation.test.mjs`
- [ ] run worker guardrail tests
- [ ] manually execute one end-to-end low-risk `echo_summary` task
- [ ] run 20 low-risk `echo_summary` tasks
- [ ] verify 0 duplicate terminal sends
- [ ] verify 0 secret leaks in logs

Exit criteria:
- 20/20 successful low-risk tasks
- 0 duplicate terminal sends
- 0 secret leaks in logs

### PR 6 - friend canary (Rodger only)

Goal:
- expose the system to exactly one real user with tight scope

Checklist:
- [ ] enable Rodger allowlist identity only
- [ ] allow only `echo_summary` and `social_draft_and_approve`
- [ ] keep external side effects disabled for scaffolded workflows
- [ ] track approval latency, terminal latency, error classes, and stuck tasks for 3 consecutive days

Exit criteria:
- 3 consecutive days with no stuck tasks
- approval and terminal latency within expected budget

### PR 7 - security hardening follow-up

Goal:
- finish the remaining security work before wider rollout

Checklist:
- [ ] add outbound domain allowlists for downstream integrations
- [ ] add secret-redaction coverage for logs and task events
- [ ] run a secret scan over worker, executor, and rollout config
- [ ] verify callback signing and secret scope are explicit and documented

Acceptance:
- malformed queue messages are rejected safely
- secret scan passes
- redaction tests pass

### PR 8 - limited production users

Goal:
- expand beyond Rodger slowly, without broadening risk too early

Checklist:
- [ ] expand allowlist gradually
- [ ] keep high-risk workflows behind explicit approval gates
- [ ] confirm rollback path still works per deployment

Acceptance:
- queue lag and task success rate remain within target after each allowlist expansion

### PR 9 - full release controls

Goal:
- make rollout reversible by workflow

Checklist:
- [ ] enable per-workflow feature flags
- [ ] keep rollback path for each workflow independently
- [ ] verify feature-flag defaults are fail-closed

Acceptance:
- each workflow can be disabled independently without disabling the entire edge path

### PR 10 - heavy workflow implementation after Rodger canary

Goal:
- implement the remaining Rodger workflows only after the low-risk path is stable

Checklist:
- [ ] implement `keynote_pdf_pack`
- [ ] implement `reservation_call_assistant`
- [ ] implement `music_generate_and_release`
- [ ] keep explicit approval gates for any external account writes, public publish, calling, or money movement

Acceptance:
- each workflow has deterministic state transitions
- each workflow has bounded retries
- each workflow has a clear terminal summary

## Definition of done for v1

- WhatsApp -> queued task -> executor -> WhatsApp terminal reply works end-to-end.
- Risk gates block unsafe side effects without approval.
- Retry and timeout controls prevent stuck tasks.
- Audit trail exists in D1 for every task.
- No secret leakage in logs.
