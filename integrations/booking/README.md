# booking integration

Purpose:

- reservation and booking workflows (for example restaurants/hotels)
- deterministic retries + fallback channels

Safety defaults:

- bounded attempts
- explicit audit trail of attempted actions
- money-sensitive actions require approval unless policy says otherwise
