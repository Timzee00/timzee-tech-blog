import { supabase } from "./supabase.js";

const NETLIFY_PROXY_URL = "/.netlify/functions/llm-proxy";
const PROVIDER_KEY = "ai_provider";

export const PROVIDERS = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic"
};

// Keep production defaults on models explicitly listed as production by the provider.
export const PROVIDER_MODELS = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"]
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
  general: "You are a helpful AI assistant for Timzee Tech Hub. Provide clear, concise, and accurate responses.",
  contentIdeas: "You are a content creation assistant. Generate creative ideas for blog posts, videos, and social media content related to technology.",
  codeHelper: "You are an expert programmer. Help users with coding questions, debugging, and best practices.",
  community: "You are a community manager. Help with community engagement strategies and moderation guidelines.",
  seo: "You are an SEO expert. Help optimize content for search engines with keywords and structure.",
  writing: "You are a professional writer. Help improve writing clarity, grammar, and engagement."
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
    model: DEFAULT_MODEL,
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
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1024,
  provider = null
} = {}) {
  const resolvedProvider = provider || getProvider();
  const payload = {
    provider: resolvedProvider,
    model,
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
      model: data.model || model
    };
  } catch (error) {
    console.error("AI API call failed:", error);
    throw error;
  }
}

export async function generateContent({
  prompt,
  systemPrompt = SYSTEM_PROMPTS.contentIdeas,
  model = DEFAULT_MODEL,
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
  model = DEFAULT_MODEL,
  provider = null
} = {}) {
  let history = [];
  if (conversationId) history = await getConversationHistory(conversationId);

  const messages = history
    .filter(msg => msg.role === "user" || msg.role === "assistant")
    .slice(-20)
    .map(msg => ({ role: msg.role, content: msg.content }));
  messages.push({ role: "user", content: message });

  const response = await callGroqAPI({
    messages,
    systemPrompt,
    model,
    provider
  });

  const responseContent = response.content || "";
  const tokensUsed = response.usage?.total_tokens || 0;

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
