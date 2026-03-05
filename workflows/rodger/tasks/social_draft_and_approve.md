# social_draft_and_approve

Status: scaffolded

Goal:
- Draft social content and require explicit approval before publish.

Inputs:
- `task_id`
- `channel`
- `prompt`

Output:
- `terminal_status`
- `draft_text`
- `approval_state`

Current scaffold behavior:
- returns deterministic draft summary
- indicates approval is required before external publish
