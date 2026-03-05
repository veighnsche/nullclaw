# Edge MVP: WhatsApp + OpenAI + Gemini + WASM policy core (Cloudflare Worker)

This example demonstrates a **hybrid edge path**:

- Edge host (`worker.mjs`) handles HTTP, secrets, WhatsApp webhook verification, OpenAI/Gemini API calls.
- Tiny Zig WASM module (`agent_core.zig`) decides response policy.

This keeps networking/secrets in the Worker host while policy logic remains swappable as WASM.

## What it does

1. Receives WhatsApp webhook events.
2. Verifies Meta webhook handshake (`GET`) and optional payload signature (`POST`) when `WHATSAPP_APP_SECRET` is set.
3. Deduplicates inbound message IDs using Cloudflare KV (optional).
4. Calls WASM `choose_policy(...)`.
5. Builds system prompt from selected policy.
6. Calls LLM providers in order: primary then fallback.
7. Sends reply back via WhatsApp Cloud API.

## Provider model routing

Configured via `wrangler.toml` vars:

- `PRIMARY_PROVIDER` = `codex` or `gemini` (strict)
- `FALLBACK_PROVIDER` = `codex` or `gemini` (strict)
- Codex model default: `gpt-5-nano`
- Gemini model default: `gemini-3.1-pro`

Current default config:

- primary: Codex (`gpt-5-nano`)
- fallback: Gemini (`gemini-3.1-pro`, fallback model `gemini-2.5-pro`)

## Prerequisites

- Cloudflare account + [`wrangler`](https://developers.cloudflare.com/workers/wrangler/)
- Zig `0.15.2`
- Meta WhatsApp Cloud API app configured
- OpenAI API key
- Gemini API key

## Build WASM policy core

From repository root:

```bash
mkdir -p examples/edge/cloudflare-worker/dist
zig build-obj examples/edge/cloudflare-worker/agent_core.zig \
  -target wasm32-freestanding \
  -fno-entry \
  -O ReleaseSmall \
  -femit-bin=examples/edge/cloudflare-worker/dist/agent_core.wasm
```

## Configure Worker secrets

```bash
cd examples/edge/cloudflare-worker

# WhatsApp
wrangler secret put WHATSAPP_VERIFY_TOKEN
wrangler secret put WHATSAPP_ACCESS_TOKEN
wrangler secret put WHATSAPP_PHONE_NUMBER_ID
wrangler secret put WHATSAPP_APP_SECRET

# LLM providers
wrangler secret put OPENAI_API_KEY
wrangler secret put GEMINI_API_KEY
```

Notes:

- `WHATSAPP_APP_SECRET` is optional but strongly recommended. If set, POST signature verification is enforced.

## Enable dedup KV (recommended)

Create KV namespaces:

```bash
cd examples/edge/cloudflare-worker
wrangler kv namespace create WHATSAPP_DEDUP
wrangler kv namespace create WHATSAPP_DEDUP --preview
```

Then add this to `wrangler.toml` (replace IDs):

```toml
[[kv_namespaces]]
binding = "WHATSAPP_DEDUP"
id = "<your_prod_namespace_id>"
preview_id = "<your_preview_namespace_id>"
```

## Deploy

```bash
cd examples/edge/cloudflare-worker
wrangler deploy
```

## Configure WhatsApp webhook in Meta

In Meta App Dashboard (WhatsApp product):

- Callback URL: `https://<your-worker-domain>/whatsapp/webhook`
- Verify token: exactly `WHATSAPP_VERIFY_TOKEN`

Meta performs GET verification using `hub.mode`, `hub.verify_token`, `hub.challenge`.

## Health check

```bash
curl "https://<your-worker-domain>/health"
```

Returns selected provider order and active model defaults.

## Worker vars in `wrangler.toml`

- `PRIMARY_PROVIDER`
- `FALLBACK_PROVIDER`
- `CODEX_MODEL`
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `LLM_TEMPERATURE`
- `DEDUP_TTL_SECONDS`

## Notes

- This example is intentionally stateless and minimal.
- The Worker implementation uses OpenAI API + Gemini API directly.
- This is not nullclaw's OAuth `openai-codex` provider flow.
- To evolve response behavior, update `agent_core.zig` and redeploy `dist/agent_core.wasm`.
