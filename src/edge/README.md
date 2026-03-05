# edge contracts

This module defines edge-first contracts without wiring behavior into runtime setup yet.

Goals:

- provide stable task and policy interfaces for edge ingress + executor services
- keep core abstractions generic and upstream-friendly
- avoid product-specific business rules in `src/`

Current scope:

- task envelope and result contracts
- risk and approval primitives
- terminal status helpers
- queued-task ledger validation and status transition guards
- queue handoff message shaping
- approval command parsing and state transitions
