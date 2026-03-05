# ElevenLabs Adapter Contract

Status: scaffolded contract

## Required Input

- `request_id` (string, required): stable id for tracing/idempotency
- `operation` (enum, required): `synthesize_speech` | `voice_profile`
- `text` (string, required for `synthesize_speech`)
- `voice_id` (string, optional)
- `audio_format` (enum, optional): `mp3` | `wav`

## Output

- `status` (enum): `succeeded` | `failed`
- `artifact_uri` (string, optional)
- `duration_ms` (u32, optional)
- `provider_request_id` (string, optional)
- `error_code` (string, optional)

## Retryability

- Retryable: provider `429`, `5xx`, timeout
- Non-retryable: auth failure, invalid input schema
- Max attempts: 3 (caller policy)

## Idempotency Behavior

- Use `request_id` as idempotency key at adapter boundary
- Duplicate requests with same key must not produce duplicate side effects

## Error Categories

- `invalid_input`
- `auth_failed`
- `rate_limited`
- `provider_unavailable`
- `timeout`
- `unknown`
