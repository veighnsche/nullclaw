# Workflows

`workflows/` contains product-level orchestration logic that composes adapters.

Guidelines:

- Keep workflows declarative and reversible.
- Keep user-specific behavior outside core runtime modules.
- Record decisions and retries in task status updates.
- Use risk gates before any external side effect.
