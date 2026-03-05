# rodger canary plan

Status: active checklist (March 5, 2026)

Stages:
1. Internal canary.
2. Friend canary (Rodger).
3. Limited production users.
4. Full release with feature flags.

Track:
- queue lag
- task success rate
- approval latency
- error classes by workflow
- cost per successful task

## Readiness checklist

- [x] D1 ledger migration exists.
- [x] Queue + D1 + KV binding scaffolds exist.
- [x] Deterministic Step 0 validation path is runnable locally.
- [x] Approval command parser exists in Zig edge contracts.
- [ ] Worker adapter is deployed with production bindings.
- [ ] Executor service is deployed and reachable from edge callback path.
- [ ] Real provider signature secret is configured.

## Stage gates

### 1) Internal canary

- Run `node --test apps/worker-cloudflare/step0_validation.test.mjs`.
- Manually execute one end-to-end low-risk `echo_summary` task.
- Confirm terminal callback updates exactly one task row and one task event.

Exit criteria:
- 20/20 successful low-risk tasks
- 0 duplicate terminal sends
- 0 secret leaks in logs

### 2) Friend canary (Rodger)

- Enable Rodger allowlist identity only.
- Allow `echo_summary` and `social_draft_and_approve` scaffold path only.
- Keep external side effects disabled for scaffolded workflows.

Exit criteria:
- 3 consecutive days with no stuck tasks
- approval/terminal latency within expected budget

### 3) Limited production users

- Expand allowlist gradually.
- Keep high-risk workflows behind explicit approval gates.

### 4) Full release with feature flags

- Enable per-workflow feature flags.
- Keep rollback path for each workflow independently.
