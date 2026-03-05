# executor

Executor service for tasks that need shell, filesystem, or long-running processes.

Responsibilities:

- Consume queued tasks from edge ingress.
- Run workflow steps in a controlled sandbox.
- Invoke integration adapters (voice, social, booking, media).
- Report status and artifacts back to the task ledger.

Security baseline:

- Default deny for outbound integrations.
- Allowlist per integration target.
- Explicit risk gates before external side effects.
- Budget, retry, and timeout limits per task type.

Deployment target:

- Any container host with shell + filesystem support (for example Cloud Run, Fly, or VM).
