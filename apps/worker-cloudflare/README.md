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

HTTP routes:

- `POST /` inbound task ingest (queued insert + queue handoff)
- `POST /terminal` executor terminal update callback

Signature header:

- `x-nullclaw-signature: sha256=<hex_hmac_sha256_of_raw_body>`

Deterministic Step 0 validation (no network):

```bash
node apps/worker-cloudflare/step0_validation.mjs
```

This validates:

- ingest webhook -> D1 queued row -> queue handoff
- Zig executor workflow run (`echo_summary`) via local driver
- terminal callback -> D1 terminal state/event update
