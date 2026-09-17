/**
 * Authenticated LLM proxy.
 * Provider API keys are server-side environment variables only.
 */
const { createClient } = require("@supabase/supabase-js");

function jsonResponse(body, status = 200) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
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

function normalizeMessages(messages = [], systemPrompt = "") {
  const normalized = Array.isArray(messages)
    ? messages
        .filter((msg) => msg && (msg.role === "user" || msg.role === "assistant" || msg.role === "system"))
        .map((msg) => ({ role: msg.role, content: String(msg.content || "") }))
    : [];

  if (systemPrompt) {
    return [{ role: "system", content: String(systemPrompt) }, ...normalized.filter((msg) => msg.role !== "system")];
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

function getBearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  if (!header || !/^Bearer\s+/i.test(header)) return "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
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
  if (!rawPayload || typeof rawPayload !== "object") {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const provider = String(rawPayload.provider || "groq").toLowerCase();
  if (!["groq", "openai", "anthropic"].includes(provider)) {
    return jsonResponse({ error: "Unsupported AI provider." }, 400);
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

  const model = String(
    rawPayload.model ||
      (provider === "openai"
        ? "gpt-4o-mini"
        : provider === "anthropic"
          ? "claude-sonnet-5"
          : "llama-3.3-70b-versatile")
  );
  const temperature = typeof rawPayload.temperature === "number" ? Math.min(Math.max(rawPayload.temperature, 0), 2) : 0.7;
  const maxTokens = typeof rawPayload.max_tokens === "number" ? Math.min(Math.max(Math.floor(rawPayload.max_tokens), 1), 8192) : 1024;
  const messages = normalizeMessages(rawPayload.messages, rawPayload.systemPrompt);

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

    const endpoint =
      provider === "openai"
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
