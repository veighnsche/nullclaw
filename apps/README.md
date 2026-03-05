# Apps

`apps/` contains deployable products built on top of `nullclaw` contracts.

Rules for this directory:

- Keep product-specific deployment code here.
- Keep vendor credentials and infra config out of `src/`.
- Depend on stable interfaces from `src/edge` and `src/*` contracts.
- Do not place user-specific prompt logic in core runtime modules.

Current app targets:

- `worker-cloudflare`: edge ingress (webhooks, auth, enqueue, quick replies).
- `executor`: long-running shell/filesystem task execution service.
