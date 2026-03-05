# Suno Adapter Contract

Status: scaffolded contract

## Required Input

- `request_id` (string, required)
- `operation` (enum, required): `generate_track` | `collect_artifacts`
- `prompt` (string, required)
- `style_tags` (array[string], optional)
- `duration_seconds` (u16, optional)

## Output

- `status` (enum): `succeeded` | `failed`
- `track_uri` (string, optional)
- `artwork_uri` (string, optional)
- `metadata_json` (string, optional)
- `provider_request_id` (string, optional)
- `error_code` (string, optional)

## Retryability

- Retryable: provider timeout, `429`, transient provider `5xx`
- Non-retryable: invalid prompt format, unsupported options
- Max attempts: 3 (caller policy)

## Idempotency Behavior

- `request_id` is idempotency key for generation request
- Duplicate keys must return same terminal record when available

## Error Categories

- `invalid_input`
- `auth_failed`
- `rate_limited`
- `provider_unavailable`
- `timeout`
- `unknown`
