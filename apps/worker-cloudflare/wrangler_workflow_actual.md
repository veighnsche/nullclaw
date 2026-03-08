# Actual Wrangler Workflow

Date: March 5, 2026

Scope:
- document the real Wrangler deployment model for `apps/worker-cloudflare`
- avoid further assumptions based on the placeholder local `wrangler.toml`

## Actual model

`apps/worker-cloudflare` is one program deployed as two separate Cloudflare Workers in account:

- `cf772d0960afaac63a91ba755590e524`

Live Worker names:

- `nullclaw-edge-whatsapp`
- `nullclaw-edge-whatsapp-rodger`

Meaning:

- same source program
- two Wrangler-managed deployments
- one instance for Vince
- one instance slot for Rodger

This is not a single-Worker deployment.

## Verified live facts

Both deployed Workers exist and have deployment/version history.

Shared live characteristics observed:

- KV namespace binding:
  - `WHATSAPP_DEDUP`
- no live Queue resources found in the account
- no live D1 database named `nullclaw_tasks`

Observed difference:

- model config differs between the two Workers
  - `nullclaw-edge-whatsapp` uses `CODEX_MODEL=gpt-5-nano`
  - `nullclaw-edge-whatsapp-rodger` uses `CODEX_MODEL=gpt-5-codex`
- secret config differs between the two Workers
  - `nullclaw-edge-whatsapp` has the WhatsApp/OpenAI secrets configured
  - `nullclaw-edge-whatsapp-rodger` currently has no secrets configured

Live status:

- `nullclaw-edge-whatsapp` is the live secret-backed instance
- `nullclaw-edge-whatsapp-rodger` is explicitly non-live until secrets are provisioned

## Practical implication

Any update flow for this app must support deploying the same Worker code to both of these names:

1. `nullclaw-edge-whatsapp`
2. `nullclaw-edge-whatsapp-rodger`

Any doc, checklist, or config that assumes a single deployed Worker called `nullclaw-worker` is inaccurate for the current live system.

## Local config shape

Local file [wrangler.toml](/home/vince/Projects/nullclaw/apps/worker-cloudflare/wrangler.toml#L1) now matches the live dual-deploy model:

- default `name = "nullclaw-edge-whatsapp"`
- `[env.rodger] name = "nullclaw-edge-whatsapp-rodger"`
- `account_id = "cf772d0960afaac63a91ba755590e524"`

This keeps one source config for both live Worker instances.

## Safe working rule

Before making PR 3 changes:

- do not assume a new Worker is being introduced
- do not assume a single deploy target
- do not assume D1/Queue are already live
- treat this as a dual-instance update to an existing Wrangler deployment

Deploy commands:

```bash
cd apps/worker-cloudflare
export CLOUDFLARE_ACCOUNT_ID=cf772d0960afaac63a91ba755590e524
export CLOUDFLARE_API_TOKEN=...
bun x wrangler deploy --env "" --keep-vars
bun x wrangler deploy --env rodger --keep-vars
```

Current live caveat:

- `--keep-vars` preserves dashboard-managed plain-text vars during deploy.
- it does not create missing secrets.
- today only `nullclaw-edge-whatsapp` has secrets configured; `nullclaw-edge-whatsapp-rodger` does not.
- treat Rodger as non-live in PR 3; do not assume it can process live WhatsApp traffic after deploy.

## Related references

- discovery dump: [wrangler_discovery_dump.md](/home/vince/Projects/nullclaw/apps/worker-cloudflare/wrangler_discovery_dump.md#L1)
- local config: [wrangler.toml](/home/vince/Projects/nullclaw/apps/worker-cloudflare/wrangler.toml#L1)
