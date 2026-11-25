import { supabase } from "./supabase.js";

const NETLIFY_PROXY_URL = "/.netlify/functions/llm-proxy";
const PROVIDER_KEY = "ai_provider";

export const PROVIDERS = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter"
};

// Keep production defaults on models explicitly listed as production by the provider.
export const PROVIDER_MODELS = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  openrouter: ["openrouter/free"]
};

export const DEFAULT_MODEL = PROVIDER_MODELS.groq[0];

export function getProvider() {
  const provider = localStorage.getItem(PROVIDER_KEY) || "groq";
  return PROVIDER_MODELS[provider] ? provider : "groq";
}

export function setProvider(provider) {
  const normalized = String(provider || "").toLowerCase();
  if (!PROVIDER_MODELS[normalized]) return false;
  localStorage.setItem(PROVIDER_KEY, normalized);
  return true;
}

export function getModelsForProvider(provider = "groq") {
  return PROVIDER_MODELS[provider] || PROVIDER_MODELS.groq;
}

export const SYSTEM_PROMPTS = {
  general: "You are Blip, Blipmood's helpful AI participant. Blipmood is a community and creator platform with discussions, videos, reels, status stories, social profiles, messaging, and a marketplace; it is NOT primarily an AI chat website. Answer accurately without claiming you can edit user data or control site features unless actual tools are available. Format responses using real Markdown paragraphs, headings, lists, links, and tables when helpful. Use real newline characters; never use literal HTML such as <br> or <table>. When asked to rewrite or edit text, provide a clearly formatted revised version, not raw instructions or visible HTML tags. Be clear about uncertainty and never invent site policies or monetization features.",
  contentIdeas: "You are Blip, helping with content creation. Generate creative ideas for blog posts, videos, and social media content related to technology.",
  codeHelper: "You are Blip, an expert programming assistant. Help users with coding questions, debugging, and best practices.",
  community: "You are Blip, a community management assistant. Help with community engagement strategies and moderation guidelines.",
  seo: "You are Blip, an SEO assistant. Help optimize content for search engines with keywords and structure.",
  writing: "You are Blip, a professional writing assistant. Help improve writing clarity, grammar, and engagement."
};

export async function savePromptTemplate(userId, title, systemPrompt, description = "", category = "general", isPublic = false) {
  return supabase.from("ai_prompts").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    system_prompt: systemPrompt,
    description,
    category,
    is_public: isPublic,
    created_at: new Date().toISOString()
  }).select().single();
}

export async function loadPromptTemplates(userId = null, isPublic = true) {
  let query = supabase.from("ai_prompts").select("*");
  if (isPublic) query = query.eq("is_public", true);
  else if (userId) query = query.eq("user_id", userId);
  const result = await query.order("created_at", { ascending: false });
  return result.data || [];
}

export async function createConversation(userId, title = "New Chat") {
  return supabase.from("ai_conversations").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    model: getModelsForProvider(getProvider())[0],
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getConversationHistory(conversationId) {
  const result = await supabase
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return result.data || [];
}

export async function saveMessage(conversationId, userId, role, content, tokensUsed = 0) {
  return supabase.from("ai_messages").insert({
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    user_id: userId,
    role,
    content,
    tokens_used: tokensUsed,
    created_at: new Date().toISOString()
  }).select().single();
}

export async function callGroqAPI({
  messages = [],
  systemPrompt = SYSTEM_PROMPTS.general,
  model = null,
  temperature = 0.7,
  maxTokens = 4096,
  provider = null
} = {}) {
  const resolvedProvider = provider || getProvider();
  const allowed = getModelsForProvider(resolvedProvider);
  const remembered = localStorage.getItem("ai_model") || "";
  const resolvedModel = allowed.includes(model) ? model : allowed.includes(remembered) ? remembered : allowed[0];
  const payload = {
    provider: resolvedProvider,
    model: resolvedModel,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false
  };

  try {
    const session = await supabase.auth.getSession();
    const accessToken = session.data?.session?.access_token;
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(NETLIFY_PROXY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `API Error: ${response.status}` };
    }

    if (!response.ok) {
      const message = data?.error?.message || data?.error || data?.message || `API Error: ${response.status}`;
      throw new Error(message);
    }

    return {
      content: data.message || data.choices?.[0]?.message?.content || "",
      usage: data.usage,
      finishReason: data.finish_reason || data.stop_reason || null,
      model: data.model || resolvedModel
    };
  } catch (error) {
    console.error("AI API call failed:", error);
    throw error;
  }
}

export async function generateContent({
  prompt,
  systemPrompt = SYSTEM_PROMPTS.contentIdeas,
  model = null,
  maxTokens = 2048,
  provider = null
} = {}) {
  return callGroqAPI({
    messages: [{ role: "user", content: prompt }],
    systemPrompt,
    model,
    maxTokens,
    provider
  });
}

export async function chat({
  conversationId = null,
  userId = null,
  message,
  systemPrompt = SYSTEM_PROMPTS.general,
  model = null,
  provider = null
} = {}) {
  let history = [];
  if (conversationId) history = await getConversationHistory(conversationId);

  const messages = history
    .filter(msg => msg.role === "user" || msg.role === "assistant")
    .slice(-20)
    .map(msg => ({ role: msg.role, content: msg.content }));
  messages.push({ role: "user", content: message });

  let response = await callGroqAPI({
    messages,
    systemPrompt: systemPrompt + "\n\nOutput budget: up to 4096 tokens per response. Prioritize a complete, useful answer within this limit. Do not stop mid-sentence or mid-list.",
    model,
    provider,
    maxTokens: 4096
  });

  let responseContent = response.content || "";
  let tokensUsed = response.usage?.total_tokens || 0;
  // If the provider explicitly reports a length stop, continue the same answer
  // automatically instead of leaving a visibly cut-off response.
  for (let continuation = 0; response.finishReason === "length" && continuation < 2; continuation += 1) {
    const continuationMessages = [
      ...messages,
      { role: "assistant", content: responseContent },
      { role: "user", content: "Continue exactly where your previous response stopped. Do not repeat earlier text. Finish the answer cleanly." }
    ];
    const next = await callGroqAPI({
      messages: continuationMessages,
      systemPrompt: systemPrompt + "\n\nContinue incomplete answers without repetition. Keep the answer accurate and finish cleanly.",
      model,
      provider,
      maxTokens: 4096
    });
    responseContent += next.content || "";
    tokensUsed += next.usage?.total_tokens || 0;
    response = next;
  }
  if (response.finishReason === "length") {
    responseContent += "\n\n[Blip reached the provider's maximum continuation limit. Ask it to continue for the remaining part.]";
  }

  if (conversationId && userId) {
    const userSave = await saveMessage(conversationId, userId, "user", message, 0);
    if (userSave.error) console.warn("Failed to save AI user message:", userSave.error);
    const assistantSave = await saveMessage(conversationId, userId, "assistant", responseContent, tokensUsed);
    if (assistantSave.error) console.warn("Failed to save AI assistant message:", assistantSave.error);
  }

  return responseContent;
}

export async function generatePostIdeas({ topic, count = 5 } = {}) {
  return generateContent({
    prompt: `Generate ${count} creative blog post ideas about "${topic}" for a tech community. Format as a numbered list with title and brief description.`,
    systemPrompt: SYSTEM_PROMPTS.contentIdeas
  });
}

export async function generateSEO({ topic, currentTitle = "", currentContent = "" } = {}) {
  return generateContent({
    prompt: `Generate SEO-optimized title, meta description, and 5 relevant keywords for a post about "${topic}". ${currentTitle ? `Current title: "${currentTitle}"` : ""} ${currentContent ? `Content preview: "${currentContent.slice(0, 200)}"` : ""} Format as JSON: { "title": "...", "metaDescription": "...", "keywords": ["..."] }`,
    systemPrompt: SYSTEM_PROMPTS.seo
  });
}

export async function improveWriting({ text, style = "professional" } = {}) {
  return generateContent({
    prompt: `Improve this ${style} writing for clarity, engagement, and grammar:\n\n"${text}"\n\nReturn only the improved text without explanation.`,
    systemPrompt: SYSTEM_PROMPTS.writing
  });
}

export async function helpWithCode({ code, question, language = "javascript" } = {}) {
  return generateContent({
    prompt: `I have a ${language} code question: ${question}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\`\n\nProvide a helpful explanation or solution.`,
    systemPrompt: SYSTEM_PROMPTS.codeHelper,
    maxTokens: 2048
  });
}

export async function checkModerationAI({ text, category = "content" } = {}) {
  const prompt = `Check if this ${category} violates community guidelines. Respond with JSON: { "safe": boolean, "reason": "explanation", "severity": "low|medium|high" }\n\nText: "${text}"`;
  try {
    const response = await generateContent({
      prompt,
      systemPrompt: "You are a content moderation AI. Be strict but fair."
    });
    const jsonMatch = String(response?.content || "").match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { safe: true, reason: "Could not parse response", severity: "low" };
  } catch (error) {
    console.error("Moderation check error:", error);
    return { safe: true, reason: "Moderation check failed", severity: "low" };
  }
}

export default {
  PROVIDERS,
  PROVIDER_MODELS,
  DEFAULT_MODEL,
  SYSTEM_PROMPTS,
  getProvider,
  setProvider,
  getModelsForProvider,
  callGroqAPI,
  generateContent,
  chat,
  createConversation,
  getConversationHistory,
  saveMessage,
  savePromptTemplate,
  loadPromptTemplates,
  generatePostIdeas,
  generateSEO,
  improveWriting,
  helpWithCode,
  checkModerationAI
};
