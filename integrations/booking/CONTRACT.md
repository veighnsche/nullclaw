# Booking Adapter Contract

Status: scaffolded contract

## Required Input

- `request_id` (string, required)
- `operation` (enum, required): `check_availability` | `hold` | `confirm`
- `target` (string, required): venue/provider identifier
- `party_size` (u16, required)
- `date_time_iso` (string, required)
- `approval_token` (string, required for money-sensitive `confirm`)

## Output

- `status` (enum): `succeeded` | `failed`
- `reservation_reference` (string, optional)
- `provider_request_id` (string, optional)
- `error_code` (string, optional)

## Retryability

- Retryable: network errors, `429`, transient provider `5xx`
- Non-retryable: invalid party/date inputs, authorization failures
- Max attempts: 3 (caller policy)

## Idempotency Behavior

- `request_id` is mandatory idempotency key
- `confirm` must not create duplicate bookings for same key

## Error Categories

- `invalid_input`
- `approval_required`
- `auth_failed`
- `rate_limited`
- `provider_unavailable`
- `timeout`
- `unknown`
