/**
 * Authenticated LLM proxy.
 * Provider API keys are server-side environment variables only.
 * This endpoint also enforces per-user request limits and bounded inputs
 * so authenticated clients cannot create unbounded provider spend.
 */
const { createClient } = require("@supabase/supabase-js");

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_INPUT_CHARS = 48000;
const MAX_MODEL_CHARS = 120;
const MAX_TOKENS = 4096;

const ALLOWED_MODELS = {
  groq: new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"]),
  openai: new Set(["gpt-4o-mini", "gpt-4o"]),
  anthropic: new Set(["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"])
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getBearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  if (!header || !/^Bearer\s+/i.test(header)) return "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

function normalizeMessages(messages = [], systemPrompt = "") {
  if (!Array.isArray(messages)) return [];
  const normalized = messages
    .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant" || msg.role === "system"))
    .map((msg) => ({ role: msg.role, content: String(msg.content || "").slice(0, MAX_MESSAGE_CHARS) }))
    .filter((msg) => msg.content.trim().length > 0);

  if (systemPrompt) {
    return [{ role: "system", content: String(systemPrompt).slice(0, MAX_MESSAGE_CHARS) }, ...normalized.filter((msg) => msg.role !== "system")];
  }
  return normalized;
}

function extractAnthropicSystem(messages = []) {
  let system = "";
  const filtered = [];
  for (const msg of messages) {
    if (msg.role === "system" && !system) {
      system = msg.content || "";
      continue;
    }
    if (msg.role === "user" || msg.role === "assistant") {
      filtered.push({ role: msg.role, content: msg.content || "" });
    }
  }
  return { system, messages: filtered };
}

function requestBodyBytes(event) {
  if (!event.body) return 0;
  try {
    return event.isBase64Encoded
      ? Buffer.from(event.body, "base64").length
      : Buffer.byteLength(event.body, "utf8");
  } catch {
    return MAX_BODY_BYTES + 1;
  }
}

function validateRequest(rawPayload, provider) {
  if (!ALLOWED_MODELS[provider]) return "Unsupported AI provider.";
  if (!Array.isArray(rawPayload.messages)) return "messages must be an array.";
  if (rawPayload.messages.length > MAX_MESSAGES) return `Too many messages. Maximum is ${MAX_MESSAGES}.`;
  if (rawPayload.model && String(rawPayload.model).length > MAX_MODEL_CHARS) return "Model name is too long.";
  if (rawPayload.systemPrompt && String(rawPayload.systemPrompt).length > MAX_MESSAGE_CHARS) return `System prompt is limited to ${MAX_MESSAGE_CHARS} characters.`;

  const totalChars = rawPayload.messages.reduce((sum, msg) => {
    if (!msg || typeof msg !== "object") return sum;
    return sum + String(msg.content || "").length;
  }, 0) + String(rawPayload.systemPrompt || "").length;

  if (totalChars > MAX_TOTAL_INPUT_CHARS) return `Prompt is too large. Maximum is ${MAX_TOTAL_INPUT_CHARS} characters.`;
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  if (requestBodyBytes(event) > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body too large." }, 413);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Server authentication is not configured." }, 500);
  }

  const token = getBearerToken(event);
  if (!token) return jsonResponse({ error: "Authentication required." }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Invalid or expired auth token." }, 401);
  }

  const rawPayload = safeJsonParse(event.body || "{}");
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const provider = String(rawPayload.provider || "groq").toLowerCase();
  const validationError = validateRequest(rawPayload, provider);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const defaultModel =
    provider === "openai"
      ? "gpt-4o-mini"
      : provider === "anthropic"
        ? "claude-sonnet-5"
        : "openai/gpt-oss-120b";
  const model = String(rawPayload.model || defaultModel);
  if (!ALLOWED_MODELS[provider].has(model)) {
    return jsonResponse({ error: "Model is not allowed for this provider." }, 400);
  }

  const apiKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.GROQ_API_KEY;

  if (!apiKey) {
    return jsonResponse({ error: `${provider} API key is not configured on the server.` }, 503);
  }

  const temperature = typeof rawPayload.temperature === "number"
    ? Math.min(Math.max(rawPayload.temperature, 0), 2)
    : 0.7;
  const maxTokens = typeof rawPayload.max_tokens === "number"
    ? Math.min(Math.max(Math.floor(rawPayload.max_tokens), 1), MAX_TOKENS)
    : 1024;
  const messages = normalizeMessages(rawPayload.messages, rawPayload.systemPrompt);
  if (!messages.length) return jsonResponse({ error: "At least one non-empty message is required." }, 400);

  const { data: limitData, error: limitError } = await supabase.rpc("consume_ai_rate_limit", {
    p_user_id: authData.user.id,
    p_request_limit: 20,
    p_window_seconds: 600,
    p_daily_limit: 100
  });

  if (limitError || !limitData) {
    console.error("AI rate limit check failed:", limitError);
    return jsonResponse({ error: "AI rate limiting is temporarily unavailable." }, 503);
  }

  if (limitData.allowed === false) {
    const retryAfter = Math.max(1, Number(limitData.retry_after) || 60);
    return jsonResponse(
      { error: "AI request limit reached. Please try again later.", reason: limitData.reason },
      429,
      { "Retry-After": String(retryAfter) }
    );
  }

  try {
    if (provider === "anthropic") {
      const { system, messages: anthropicMessages } = extractAnthropicSystem(messages);
      const anthropicPayload = {
        model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: anthropicMessages
      };

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(anthropicPayload)
      });

      const text = await resp.text();
      const data = safeJsonParse(text) || {};
      if (!resp.ok) {
        return jsonResponse({ error: data.error || text || "Anthropic API error" }, resp.status);
      }

      const content = Array.isArray(data.content)
        ? data.content.map((c) => c.text || "").join("")
        : "";

      return jsonResponse({
        success: true,
        message: content || "No response from AI",
        model: data.model || model,
        usage: data.usage
      });
    }

    const endpoint = provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.groq.com/openai/v1/chat/completions";

    const completionPayload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(completionPayload)
    });

    const text = await resp.text();
    const data = safeJsonParse(text) || {};
    if (!resp.ok) {
      return jsonResponse({ error: data.error || text || "API error" }, resp.status);
    }

    const message = data.choices?.[0]?.message?.content || data.message || "No response from AI";
    return jsonResponse({
      success: true,
      message,
      model: data.model || model,
      usage: data.usage
    });
  } catch (error) {
    console.error("LLM proxy error:", error);
    return jsonResponse({ error: "Failed to process request." }, 500);
  }
};
