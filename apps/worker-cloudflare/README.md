# worker-cloudflare

Cloudflare Worker edge ingress app.

Responsibilities:

- Receive and validate inbound channel webhooks.
- Verify signatures and reject invalid requests.
- Deduplicate message IDs using KV.
- Classify risk and enqueue work for downstream execution.
- Send quick acknowledgements.
- Accept executor terminal callbacks and format final status messages.

Non-goals:

- No shell commands.
- No local filesystem access.
- No long-running orchestration loops.

Suggested bindings:

- `KV`: dedup + short-lived idempotency keys.
- `D1`: durable task ledger and approval state.
- `Queues`: async handoff to executor/orchestrator.
- `R2`: artifacts (audio, PDFs, image outputs).

Language boundary:

- Keep this app as a thin transport adapter.
- Put policy/state/business logic in Zig (`src/edge`, `apps/executor`).
- Avoid duplicating policy logic in worker runtime code.

Required binding names:

- `WHATSAPP_DEDUP` (KV)
- `TASKS_DB` (D1)
- `TASK_QUEUE` (Queue producer)

Optional guardrail env vars:

- `DAILY_TASK_LIMIT` (default `50`)
- `PER_MINUTE_TASK_LIMIT` (default `10`)
- `MAX_PROMPT_BYTES` (default `4000`)
- `MAX_MODEL_TOKENS` (default `2000`, estimated as `ceil(prompt_bytes / 4)`)
- `FAILURES_BEFORE_COOLDOWN` (default `3`)
- `FAILURE_COOLDOWN_SECONDS` (default `300`)
- `DAILY_COST_BUDGET_CENTS` (default `10000`)

HTTP routes:

- `POST /` inbound task ingest (queued insert + queue handoff)
- `POST /terminal` executor terminal update callback

Signature header:

- `x-nullclaw-signature: sha256=<hex_hmac_sha256_of_raw_body>`

Deterministic Step 0 validation (no network):

```bash
node apps/worker-cloudflare/step0_validation.mjs
```

Local prerequisites:

- run from the repository root
- `node` available locally
- Zig `0.15.2` available as `zig` on `PATH`, or set `NULLCLAW_ZIG_BIN=/absolute/path/to/zig`
- no network access is required

If Zig is missing, the script exits early with a prerequisite error instead of a generic executor failure.

This validates:

- ingest webhook -> D1 queued row -> queue handoff
- Zig executor workflow run (`echo_summary`) via local driver
- terminal callback -> D1 terminal state/event update

Deterministic regression test:

```bash
node --test apps/worker-cloudflare/step0_validation.test.mjs
```
