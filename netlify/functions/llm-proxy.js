/**
 * LLM Proxy Function
 * Routes requests to Groq/OpenAI/Anthropic using either env keys or user-provided keys.
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeMessages(messages = [], systemPrompt = "") {
  const normalized = Array.isArray(messages) ? messages : [];
  if (systemPrompt) {
    return [{ role: "system", content: systemPrompt }, ...normalized];
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

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const raw = req.body || "";
  const payload = safeJsonParse(raw) || {};
  const provider = (payload.provider || "groq").toLowerCase();
  const apiKey =
    payload.apiKey ||
    (provider === "openai" ? process.env.OPENAI_API_KEY : null) ||
    (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : null) ||
    process.env.GROQ_API_KEY;

  if (!apiKey) {
    return jsonResponse({ error: "API key not configured on server." }, 500);
  }

  const model =
    payload.model ||
    (provider === "openai"
      ? "gpt-4o-mini"
      : provider === "anthropic"
        ? "claude-sonnet-5"
        : "llama-3.3-70b-versatile");
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.7;
  const maxTokens = typeof payload.max_tokens === "number" ? payload.max_tokens : 1024;
  const messages = normalizeMessages(payload.messages, payload.systemPrompt);

  try {
    if (provider === "anthropic") {
      const { system, messages: anthropicMessages } = extractAnthropicSystem(messages);
      const anthropicPayload = {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
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

    const message =
      data.choices?.[0]?.message?.content || data.message || "No response from AI";

    return jsonResponse({
      success: true,
      message,
      model: data.model || model,
      usage: data.usage
    });
  } catch (error) {
    return jsonResponse({ error: "Failed to process request", message: error.message }, 500);
  }
};
