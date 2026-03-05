# worker-cloudflare

Cloudflare Worker edge ingress app.

Responsibilities:

- Receive and validate inbound channel webhooks.
- Verify signatures and reject invalid requests.
- Deduplicate message IDs using KV.
- Classify risk and enqueue work for downstream execution.
- Send quick acknowledgements and final status messages.

Non-goals:

- No shell commands.
- No local filesystem access.
- No long-running orchestration loops.

Suggested bindings:

- `KV`: dedup + short-lived idempotency keys.
- `D1`: durable task ledger and approval state.
- `Queues`: async handoff to executor/orchestrator.
- `R2`: artifacts (audio, PDFs, image outputs).
