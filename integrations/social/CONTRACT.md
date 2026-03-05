# Social Adapter Contract

Status: scaffolded contract

## Required Input

- `request_id` (string, required)
- `operation` (enum, required): `draft` | `publish`
- `platform` (enum, required): `instagram` | `linkedin` | `x`
- `content_text` (string, required)
- `media_refs` (array[string], optional)
- `approval_token` (string, required for `publish`)

## Output

- `status` (enum): `succeeded` | `failed`
- `draft_id` (string, optional)
- `published_post_id` (string, optional)
- `provider_request_id` (string, optional)
- `error_code` (string, optional)

## Retryability

- Retryable: `429`, transient `5xx`, timeout
- Non-retryable: invalid approval token, invalid content policy
- Max attempts: 3 (caller policy)

## Idempotency Behavior

- `request_id` is the idempotency key
- `publish` must be idempotent for repeated identical requests

## Error Categories

- `invalid_input`
- `approval_required`
- `auth_failed`
- `rate_limited`
- `provider_unavailable`
- `timeout`
- `unknown`
