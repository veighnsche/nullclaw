# Integrations

`integrations/` contains vendor-specific adapters and connector code.

Design constraints:

- Keep vendor API details out of core `src/`.
- Keep each integration behind a stable adapter interface.
- Avoid cross-coupling between integrations.
- Use contract tests with mocked transport.

Each integration should define:

- input contract
- output contract
- error taxonomy
- retryability semantics
- required secrets
