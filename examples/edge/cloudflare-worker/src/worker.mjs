import agent_core_wasm from "../dist/agent_core.wasm";

let wasm_instance_promise;

const POLICY_CONCISE = 0;
const POLICY_DETAILED = 1;
const POLICY_URGENT = 2;
const DEFAULT_DEDUP_TTL_SECONDS = 86400;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CODEX_MODEL = "gpt-5-nano";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro";
const SHA256_PREFIX = "sha256=";

function ensure_method(req, method) {
  if (req.method !== method) {
    return new Response("method not allowed", { status: 405 });
  }
  return null;
}

function extract_text_features(text) {
  const lower = text.toLowerCase();
  return {
    text_len: text.length,
    has_question: text.includes("?") ? 1 : 0,
    has_urgent_keyword: /\b(urgent|asap|immediately|critical|срочно|немедленно|критично)\b/.test(lower) ? 1 : 0,
    has_code_hint: /```|\b(code|bug|error|stack|trace|zig|compile|build)\b/.test(lower) ? 1 : 0,
  };
}

function policy_system_prompt(policy) {
  if (policy === POLICY_URGENT) {
    return "You are an incident-response assistant. Be concise, prioritize safety and immediate next steps.";
  }
  if (policy === POLICY_DETAILED) {
    return "You are a technical assistant. Give concrete, step-by-step guidance with explicit commands when useful.";
  }
  return "You are a concise assistant. Answer directly and avoid unnecessary detail.";
}

function parse_dedup_ttl_seconds(env) {
  const raw = env.DEDUP_TTL_SECONDS;
  if (typeof raw !== "string" || raw.length === 0) {
    return DEFAULT_DEDUP_TTL_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 60 || parsed > 7 * 24 * 3600) {
    return DEFAULT_DEDUP_TTL_SECONDS;
  }
  return parsed;
}

function bytes_to_hex(bytes) {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function timing_safe_equal_hex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function get_dedup_kv(env) {
  const kv = env.WHATSAPP_DEDUP;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return null;
  }
  return kv;
}

async function is_duplicate_whatsapp_message(env, message_id) {
  if (typeof message_id !== "string" || message_id.length === 0) {
    return false;
  }

  const kv = get_dedup_kv(env);
  if (!kv) {
    return false;
  }

  const dedup_key = `wa:msg:${message_id}`;
  try {
    const existing = await kv.get(dedup_key);
    if (existing !== null) {
      return true;
    }

    await kv.put(dedup_key, "1", {
      expirationTtl: parse_dedup_ttl_seconds(env),
    });
    return false;
  } catch {
    // Fail open on KV issues to avoid dropping valid messages.
    return false;
  }
}

async function get_wasm_instance() {
  if (!wasm_instance_promise) {
    wasm_instance_promise = WebAssembly.instantiate(agent_core_wasm, {});
  }
  return wasm_instance_promise;
}

async function choose_policy_from_wasm(text) {
  try {
    const inst = await get_wasm_instance();
    const features = extract_text_features(text);
    const choose_policy = inst.instance.exports.choose_policy;
    if (typeof choose_policy !== "function") {
      return POLICY_CONCISE;
    }
    return choose_policy(
      features.text_len,
      features.has_question,
      features.has_urgent_keyword,
      features.has_code_hint,
    ) >>> 0;
  } catch {
    return POLICY_CONCISE;
  }
}

function normalize_provider_name(raw, fallback) {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  const provider = raw.trim().toLowerCase();
  if (provider === "codex" || provider === "gemini") return provider;
  return fallback;
}

function provider_order(env) {
  const primary = normalize_provider_name(env.PRIMARY_PROVIDER, "codex");
  const fallback = normalize_provider_name(env.FALLBACK_PROVIDER, primary === "codex" ? "gemini" : "codex");
  if (primary === fallback) return [primary];
  return [primary, fallback];
}

function parse_temperature(env) {
  const raw = env.LLM_TEMPERATURE;
  if (typeof raw !== "string" || raw.length === 0) return 0.2;
  const temp = Number.parseFloat(raw);
  if (!Number.isFinite(temp)) return 0.2;
  if (temp < 0) return 0;
  if (temp > 2) return 2;
  return temp;
}

async function call_codex(env, system_prompt, user_text) {
  const api_key = env.OPENAI_API_KEY;
  if (!api_key) {
    throw new Error("missing OPENAI_API_KEY");
  }

  const model = env.CODEX_MODEL || DEFAULT_CODEX_MODEL;
  const base_url = DEFAULT_OPENAI_BASE_URL;

  const response = await fetch(`${base_url}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system_prompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: user_text }],
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const msg = payload?.error?.message || "codex request failed";
    throw new Error(`codex error: ${msg}`);
  }

  const text = extract_openai_text(payload);
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("codex returned empty content");
  }
  return text;
}

function extract_openai_text(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }
  return null;
}

function gemini_model_path(model) {
  if (model.startsWith("models/")) return model;
  return `models/${model}`;
}

function extract_gemini_text(payload) {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }
  return null;
}

async function call_gemini_once(env, model, system_prompt, user_text) {
  const api_key = env.GEMINI_API_KEY;
  if (!api_key) {
    throw new Error("missing GEMINI_API_KEY");
  }

  const path = gemini_model_path(model);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${path}:generateContent?key=${encodeURIComponent(api_key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          role: "system",
          parts: [{ text: system_prompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: user_text }],
          },
        ],
        generationConfig: {
          temperature: parse_temperature(env),
        },
      }),
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    const msg = payload?.error?.message || "gemini request failed";
    throw new Error(`gemini error (${model}): ${msg}`);
  }

  const text = extract_gemini_text(payload);
  if (!text) {
    throw new Error(`gemini returned empty content (${model})`);
  }
  return text;
}

async function call_gemini(env, system_prompt, user_text) {
  const primary_model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const fallback_model = env.GEMINI_FALLBACK_MODEL;

  try {
    return await call_gemini_once(env, primary_model, system_prompt, user_text);
  } catch (primary_err) {
    console.warn("gemini_primary_failed", {
      model: primary_model,
      error: primary_err instanceof Error ? primary_err.message : String(primary_err),
    });
    if (!fallback_model || fallback_model === primary_model) {
      throw primary_err;
    }
    return await call_gemini_once(env, fallback_model, system_prompt, user_text);
  }
}

async function call_llm_with_fallback(env, system_prompt, user_text) {
  const providers = provider_order(env);
  const errors = [];

  for (const provider of providers) {
    try {
      if (provider === "codex") {
        const text = await call_codex(env, system_prompt, user_text);
        return {
          provider,
          text,
        };
      }
      if (provider === "gemini") {
        const text = await call_gemini(env, system_prompt, user_text);
        return {
          provider,
          text,
        };
      }
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      console.warn("provider_failed", {
        provider,
        error: error_msg,
      });
      errors.push(`${provider}: ${error_msg}`);
    }
  }

  throw new Error(`all providers failed (${errors.join(" | ")})`);
}

async function send_whatsapp(env, to, text, reply_to_message_id) {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN");
  }

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  };

  if (reply_to_message_id) {
    body.context = { message_id: reply_to_message_id };
  }

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`whatsapp send failed: ${payload}`);
  }
}

async function verify_whatsapp_signature(req, env, raw_body) {
  if (!env.WHATSAPP_APP_SECRET) return true;

  const header = req.headers.get("x-hub-signature-256");
  if (!header || !header.startsWith(SHA256_PREFIX)) return false;

  const provided_hex = header.slice(SHA256_PREFIX.length).toLowerCase();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.WHATSAPP_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(raw_body));
  const computed_hex = bytes_to_hex(new Uint8Array(signature));
  return timing_safe_equal_hex(provided_hex, computed_hex);
}

function extract_whatsapp_messages(payload) {
  const out = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const msg of messages) {
        if (msg?.type !== "text") continue;

        const text = msg?.text?.body;
        const from = msg?.from;
        const message_id = msg?.id;

        if (typeof text !== "string" || text.length === 0) continue;
        if (typeof from !== "string" || from.length === 0) continue;

        out.push({
          from,
          text,
          message_id: typeof message_id === "string" ? message_id : null,
        });
      }
    }
  }

  return out;
}

function verify_whatsapp_handshake(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";

  if (mode !== "subscribe") {
    console.warn("whatsapp_verify_rejected", { reason: "invalid_mode", mode });
    return new Response("forbidden", { status: 403 });
  }
  if (!env.WHATSAPP_VERIFY_TOKEN || token !== env.WHATSAPP_VERIFY_TOKEN) {
    console.warn("whatsapp_verify_rejected", {
      reason: "verify_token_mismatch_or_missing_secret",
      has_secret: Boolean(env.WHATSAPP_VERIFY_TOKEN),
    });
    return new Response("forbidden", { status: 403 });
  }

  console.log("whatsapp_verify_ok");
  return new Response(challenge, { status: 200 });
}

async function handle_whatsapp_verify(req, env, url) {
  const invalid_method = ensure_method(req, "GET");
  if (invalid_method) return invalid_method;
  return verify_whatsapp_handshake(url, env);
}

async function handle_whatsapp_webhook(req, env) {
  const invalid_method = ensure_method(req, "POST");
  if (invalid_method) return invalid_method;

  const raw_body = await req.text();
  if (!(await verify_whatsapp_signature(req, env, raw_body))) {
    console.warn("whatsapp_signature_invalid");
    return new Response("forbidden", { status: 403 });
  }

  let payload;
  try {
    payload = JSON.parse(raw_body);
  } catch {
    console.warn("whatsapp_invalid_json");
    return new Response("invalid json", { status: 400 });
  }
  const incoming = extract_whatsapp_messages(payload);
  console.log("whatsapp_incoming", { count: incoming.length });

  if (incoming.length === 0) {
    console.log("whatsapp_skipped_no_text_messages");
    return Response.json({ ok: true, skipped: true });
  }

  let processed = 0;
  let deduped = 0;
  let sent = 0;
  let failed = 0;

  for (const msg of incoming) {
    if (await is_duplicate_whatsapp_message(env, msg.message_id)) {
      deduped += 1;
      console.log("whatsapp_deduped_message");
      continue;
    }

    processed += 1;

    try {
      const policy = await choose_policy_from_wasm(msg.text);
      const system_prompt = policy_system_prompt(policy);
      const llm = await call_llm_with_fallback(env, system_prompt, msg.text);
      await send_whatsapp(env, msg.from, llm.text, msg.message_id);
      sent += 1;
      console.log("whatsapp_replied", { provider: llm.provider, policy });
    } catch (err) {
      failed += 1;
      console.error("whatsapp_message_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("whatsapp_summary", { processed, deduped, sent, failed });
  return Response.json({ ok: true, processed, deduped, sent, failed });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        providers: provider_order(env),
        codex_model: env.CODEX_MODEL || DEFAULT_CODEX_MODEL,
        gemini_model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      });
    }

    if (url.pathname === "/whatsapp/webhook" && req.method === "GET") {
      return handle_whatsapp_verify(req, env, url);
    }

    if (url.pathname === "/whatsapp/webhook" && req.method === "POST") {
      try {
        return await handle_whatsapp_webhook(req, env);
      } catch (err) {
        console.error("whatsapp_webhook_unhandled_error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return new Response(`whatsapp webhook error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
