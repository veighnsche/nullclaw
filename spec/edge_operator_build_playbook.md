# Edge Operator Build Playbook

Status: working draft  
Date: March 5, 2026  
Scope: turn the current WhatsApp + LLM edge bot into a production-ready semi-autonomous operator architecture.

## 1) Goal

Build a hybrid architecture where:

- Cloudflare Worker is the edge ingress and policy frontdoor.
- Long-running or shell/filesystem tasks run in a separate executor service.
- Risky actions require confirmation.
- Low-risk actions run automatically.
- The codebase remains clean and upstream-friendly later.

## 2) Current Baseline (already done)

- Cloudflare Worker deployed for WhatsApp webhooks.
- OpenAI path wired with `gpt-5-nano`.
- Gemini fallback path wired (requires key).
- WhatsApp signature verification supported.
- Dedup via KV supported.
- Added architecture scaffold:
  - `apps/`
  - `integrations/`
  - `workflows/`
  - `src/edge/contracts.zig`

## 3) Target Architecture

### 3.1 Runtime Split

- Edge:
  - `apps/worker-cloudflare`
  - webhook validation
  - idempotency/dedup
  - risk classification
  - enqueue task
  - quick ack + final status posting
- Control plane:
  - Cloudflare Queues + D1 + KV (+ R2 for artifacts)
- Heavy execution:
  - `apps/executor`
  - shell/filesystem-capable service (Cloud Run/Fly/VM)
  - integrations execution
  - status updates back to D1/Worker

### 3.2 Policy Model

- `low + local` -> auto
- `medium + local` -> confirm
- `external_account/public_publish/money` -> confirm
- `high` -> confirm always

Policy helper exists in `src/edge/contracts.zig` and should be used as the single policy primitive.

### 3.3 Language Boundary (Zig-first)

- Canonical business logic lives in Zig (`src/edge/**`, `apps/executor/**`):
  - policy decisions
  - task status transitions
  - approval command parsing
  - queue/task contract shaping
- `apps/worker-cloudflare` is a thin edge adapter only:
  - webhook transport
  - signature verification
  - KV dedup
  - D1/Queue binding
- Keep TypeScript surface minimal and avoid duplicating core policy/state logic there.

## 4) Delivery Plan (step by step)

## Step 0 - Freeze scope and acceptance criteria

Define first deliverable as:

- WhatsApp inbound message
- task creation in D1
- task enqueued
- executor consumes and returns result
- WhatsApp receives terminal result message

Do not include social posting, voice calls, booking, or Suno in Step 0.

Acceptance:

- one end-to-end demo for a text task
- no manual DB edits needed
- no secrets in logs

## Step 1 - Standardize edge contracts

Files:

- `src/edge/contracts.zig`
- `src/edge/task_envelope.schema.json`

Tasks:

- keep task envelope fields stable
- add any missing optional fields now (not later in flight):
  - `trace_id`
  - `deadline_unix`
  - `budget_cents`
- add schema version string in envelope metadata

Acceptance:

- schema and Zig contract agree on field names and enums
- unit tests cover approval decisions and terminal status

## Step 2 - Provision Cloudflare control plane

Create/verify:

- Worker script
- KV namespace for dedup
- D1 database for task ledger
- Queue for async execution
- optional R2 bucket for artifacts

Commands (example):

```bash
cd apps/worker-cloudflare
npx wrangler kv namespace create WHATSAPP_DEDUP
npx wrangler d1 create nullclaw_tasks
npx wrangler queues create nullclaw-task-queue
```

Acceptance:

- all resource IDs are in `wrangler.toml`
- bindings visible in `wrangler deploy` output

## Step 3 - Add D1 task ledger schema

Create SQL migration for:

- `tasks`
- `task_events`
- `task_artifacts`

Minimum `tasks` fields:

- `id` (PK)
- `status`
- `workflow`
- `risk_level`
- `action_target`
- `requested_by`
- `channel`
- `prompt`
- `attempts`
- `created_at`
- `updated_at`
- `last_error`

Acceptance:

- can insert queued task
- can append events
- can transition state with optimistic update

## Step 4 - Worker adapter (thin): ingest -> persist -> enqueue

Implement in `apps/worker-cloudflare`:

1. parse inbound channel payload
2. verify signature
3. dedup id
4. write queued task row in D1
5. enqueue task JSON to Queue
6. send quick ack to channel

Ack style:

- short and deterministic
- include task id for support tracing

Acceptance:

- repeated webhook with same message ID does not enqueue duplicate task
- D1 row + queue message both created once

## Step 5 - Executor service skeleton

Implement in `apps/executor`:

- queue consumer entrypoint
- task fetch from D1 by id
- state transition `queued -> running`
- apply policy/state helpers from `src/edge/**`
- execute one simple built-in workflow
- write terminal state + summary

Add hard limits:

- max attempts
- per-task timeout
- per-step timeout

Acceptance:

- failed task records error details
- task eventually lands in terminal state

## Step 6 - Worker terminal notifier

Add notifier path:

- worker polls/receives completion event
- sends final WhatsApp message:
  - `Gelukt`
  - or `Niet gelukt, dit is geprobeerd: ...`

Acceptance:

- user always gets terminal response
- no double-send on retries

## Step 7 - Risk gates and approvals

Add approval state machine:

- `waiting_approval`
- `approved`
- `rejected`

Add channel command parsing for approval:

- `posten maar` -> approve
- `aanpassen: ...` -> update task intent and re-run drafting

Acceptance:

- high-risk tasks cannot execute external side effects without approval
- approval transitions are audit logged

## Step 8 - Integration adapter interfaces

Define adapter contracts first, vendor second.

Add interface documents and stubs for:

- `integrations/elevenlabs`
- `integrations/social`
- `integrations/booking`
- `integrations/suno`

Each adapter contract must define:

- required input
- output
- retryability
- idempotency key behavior
- error categories

Acceptance:

- executor workflows depend on interfaces, not vendor SDK details

## Step 9 - Implement workflows in order

Priority order:

1. `social_draft_and_approve`
2. `keynote_pdf_pack`
3. `reservation_call_assistant`
4. `music_generate_and_release`

### 9.1 social_draft_and_approve

- generate draft text + image prompts
- optional image generation
- present draft
- post only on explicit approval

### 9.2 keynote_pdf_pack

- gather sources
- generate structured outline
- render PDF artifact
- attach artifact to final response

### 9.3 reservation_call_assistant

- generate call script
- synthesize voice if needed
- call attempt with bounded retries
- summarize outcome + evidence

### 9.4 music_generate_and_release

- generate track prompts
- generate artwork
- package metadata
- push to distribution integration behind approval gate

Acceptance:

- each workflow has:
  - deterministic state transitions
  - bounded retries
  - clear terminal summary

## Step 10 - Security hardening

Mandatory controls:

- least-privilege API tokens per integration
- per-integration secret scope
- outbound domain allowlist
- redact tokens from logs and task events
- signed callback validation
- strict JSON schema validation on queue payloads

Acceptance:

- secret scan passes
- redaction tests pass
- malformed queue messages are rejected safely

## Step 11 - Cost and abuse controls

Add guardrails:

- per-user daily budget cap
- per-task max model tokens
- max retries per workflow
- rate limits by sender
- cooldown for repeated failures

Acceptance:

- runaway loops terminate
- cost ceilings enforced in code, not docs-only

## Step 12 - Testing matrix

### Unit

- contracts and policy decisions
- state transition rules
- adapter error mapping

### Integration

- worker ingest + queue enqueue
- executor consumes and updates D1
- notifier sends terminal message

### Failure mode

- provider timeout
- adapter 429/500
- queue duplicate delivery
- D1 transient errors

### Security

- signature mismatch rejected
- approval bypass attempts rejected
- invalid schema payload rejected

Acceptance:

- deterministic tests
- no real network in unit tests

## Step 13 - Rollout plan

1. internal canary (single test number)
2. friend canary (Rodger)
3. limited production users
4. full release with feature flags

Track:

- queue lag
- task success rate
- approval latency
- error classes by workflow
- cost per successful task

## Step 14 - Upstream-readiness checkpoints (for future PRs)

Keep private/custom:

- product prompts
- vendor account wiring
- personal workflow copy/style

Candidate for upstream later:

- `src/edge/contracts.zig` primitives
- generic risk/approval model
- generic async task status model
- runtime capability profile improvements for cloudflare

Acceptance:

- no personal names in core modules
- no vendor lock-in inside `src/`

## 5) Immediate Next 7 Tasks

Status update (March 5, 2026):

1. [x] Add D1 schema migration for task ledger.
2. [x] Bind Queue + D1 in `apps/worker-cloudflare` (thin adapter only).
3. [x] Implement `queued` task insert + enqueue in worker adapter.
4. [x] Scaffold Zig queue consumer in `apps/executor` and wire `src/edge` helpers.
5. [x] Implement one Zig test workflow: `echo_summary`.
6. [x] Implement terminal notifier path with Zig-first logic and thin channel adapter.
7. [x] Implement approval command parsing + state transition in `src/edge` (Zig).

Rodger rollout status:

- friend canary (Rodger): not started yet

Next big milestone (remaining from v1 scope):

- Ship a deterministic end-to-end validation path for Step 0:
  - webhook ingest -> D1 queued row -> queue handoff -> executor run -> terminal callback
  - include integration tests for worker routes (`/` and `/terminal`) with no real network
  - add strict signature verification and optimistic status transition checks in callback path

## 6) Definition of Done for v1

- WhatsApp -> queued task -> executor -> WhatsApp terminal reply works end-to-end.
- Risk gates block unsafe side effects without approval.
- Retry and timeout controls prevent stuck tasks.
- Audit trail exists in D1 for every task.
- No secret leakage in logs.
