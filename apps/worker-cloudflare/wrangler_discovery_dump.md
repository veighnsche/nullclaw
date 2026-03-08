# Wrangler Discovery Dump

Date: March 5, 2026

Scope:
- establish the real Cloudflare/Wrangler deployment context for `apps/worker-cloudflare`
- stop inferring deployment behavior from local docs alone

## Commands run

From `apps/worker-cloudflare`:

```bash
bun x wrangler --version
bun x wrangler whoami
```

Then, after Wrangler reported multiple accounts, the account was pinned explicitly:

```bash
CLOUDFLARE_ACCOUNT_ID=<account_id> bun x wrangler deployments list --name <worker-name>
CLOUDFLARE_ACCOUNT_ID=<account_id> bun x wrangler versions list --name <worker-name>
CLOUDFLARE_ACCOUNT_ID=<account_id> bun x wrangler d1 list
CLOUDFLARE_ACCOUNT_ID=<account_id> bun x wrangler queues list
CLOUDFLARE_ACCOUNT_ID=<account_id> bun x wrangler kv namespace list
```

Cloudflare API was also queried directly with the Wrangler OAuth token to list Worker scripts and inspect Worker settings.

## Wrangler auth state

Verified with `bun x wrangler whoami`:

- authenticated user email: `vincepaul.liem@gmail.com`
- Wrangler version: `4.70.0`

Available accounts:

- `Junebonnet@hotmail.nl's Account`
  - `bce75e6d72016186da22d710ef811e77`
- `Vincepaul.liem@gmail.com's Account`
  - `cf772d0960afaac63a91ba755590e524`

Important:
- this repository does not currently pin a Cloudflare account in [wrangler.toml](/home/vince/Projects/nullclaw/apps/worker-cloudflare/wrangler.toml)
- non-interactive Wrangler commands fail until `CLOUDFLARE_ACCOUNT_ID` is set

## Local config vs live deployment

Local config in [wrangler.toml](/home/vince/Projects/nullclaw/apps/worker-cloudflare/wrangler.toml):

- worker name: `nullclaw-worker`
- KV binding: `WHATSAPP_DEDUP`
- D1 binding: `TASKS_DB`
- Queue binding: `TASK_QUEUE`
- D1 database name: `nullclaw_tasks`
- Queue name: `nullclaw-task-queue`

Observed live state:

- no Worker named `nullclaw-worker` exists in either authenticated account

This means the local `wrangler.toml` name does not match the currently deployed Worker names.

## Live Worker names in the active account

Direct Cloudflare API query for account `cf772d0960afaac63a91ba755590e524` returned these Worker scripts:

- `cond8-docs`
- `global-worker-catalog`
- `nullclaw-edge-whatsapp`
- `nullclaw-edge-whatsapp-rodger`
- `rbee-admin`
- `tenxten`
- `veighnsche`
- `veighnsche-car-engine-pet2`

Relevant Workers for this project:

- `nullclaw-edge-whatsapp`
- `nullclaw-edge-whatsapp-rodger`

## Deployment history observed

`nullclaw-edge-whatsapp`:

- multiple versions and deployments exist on March 4, 2026
- observed deployment sources include:
  - `Upload`
  - `Secret Change`
  - `Unknown (deployment)`
  - `Unknown (version_upload)`

`nullclaw-edge-whatsapp-rodger`:

- multiple versions and deployments exist on March 4, 2026
- observed deployment sources include:
  - `Upload`
  - `Secret Change`
  - `Unknown (deployment)`
  - `Unknown (version_upload)`

This confirms both Workers are real deployed scripts managed through Wrangler/Cloudflare already.

## Live bindings actually present

### `nullclaw-edge-whatsapp`

Observed bindings from Worker settings:

- plain text vars:
  - `CODEX_MODEL=gpt-5-nano`
  - `DEDUP_TTL_SECONDS=86400`
  - `FALLBACK_PROVIDER=gemini`
  - `GEMINI_FALLBACK_MODEL=gemini-2.5-pro`
  - `GEMINI_MODEL=gemini-3.1-pro`
  - `LLM_TEMPERATURE=0.2`
  - `PRIMARY_PROVIDER=codex`
- secrets:
  - `OPENAI_API_KEY`
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_APP_SECRET`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_VERIFY_TOKEN`
- KV:
  - `WHATSAPP_DEDUP`
    - namespace id: `c7a405750f4b41538c8b5f0b124a0141`

### `nullclaw-edge-whatsapp-rodger`

Observed bindings from Worker settings:

- plain text vars:
  - `CODEX_MODEL=gpt-5-codex`
  - `DEDUP_TTL_SECONDS=86400`
  - `FALLBACK_PROVIDER=gemini`
  - `GEMINI_FALLBACK_MODEL=gemini-2.5-pro`
  - `GEMINI_MODEL=gemini-3.1-pro`
  - `LLM_TEMPERATURE=0.2`
  - `PRIMARY_PROVIDER=codex`
- KV:
  - `WHATSAPP_DEDUP`
    - namespace id: `c7a405750f4b41538c8b5f0b124a0141`

Observed via `bun x wrangler secret list --name nullclaw-edge-whatsapp-rodger`:

- no secrets currently configured

## Live resources not found

In account `cf772d0960afaac63a91ba755590e524`:

- Queues:
  - none found
- D1 databases:
  - `personal_db`
  - `hexaco-tests`
- specifically not found:
  - D1 database `nullclaw_tasks`
  - Queue `nullclaw-task-queue`

Implication:
- the live deployment does not currently match the D1 + Queue plan described in local docs/specs
- the live deployment appears to still be the earlier KV-backed WhatsApp Worker shape

## KV namespaces found

In account `cf772d0960afaac63a91ba755590e524`, Wrangler listed:

- `WHATSAPP_DEDUP`
  - id: `c7a405750f4b41538c8b5f0b124a0141`
- `WHATSAPP_DEDUP_preview`
  - id: `190d34b6b20e4cd99f79214de0ecb0e6`

This matches the live Worker settings and confirms the active account.

## Conclusions

1. `apps/worker-cloudflare` is not currently pointed at the real deployed Worker names.
2. The real deployed Workers are `nullclaw-edge-whatsapp` and `nullclaw-edge-whatsapp-rodger`.
3. These two Workers are the same program deployed twice for two people:
   - `nullclaw-edge-whatsapp` for Vince
   - `nullclaw-edge-whatsapp-rodger` for Rodger
4. The live Cloudflare account currently shows:
   - KV in use
   - WhatsApp/OpenAI secrets configured for Vince's Worker
   - no secrets configured for Rodger's Worker
   - no Rodger D1 task ledger
   - no task queue
5. Any PR 3 work must preserve the dual-deploy model instead of collapsing to one Worker name.
6. Any future Wrangler config/doc changes must account for two deployed Worker names, not one.
7. Rodger should be treated as explicitly non-live until secrets are provisioned.

## Resolved deployment model

`apps/worker-cloudflare` maps to both live Worker instances:

- `nullclaw-edge-whatsapp`
- `nullclaw-edge-whatsapp-rodger`

Operationally:

- one source program
- two Wrangler-managed deployments
- per-instance config/secrets may differ
