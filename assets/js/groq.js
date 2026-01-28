import { supabase } from "./supabase.js";

// Groq API Configuration (Now handled by backend via Netlify function)
// API key is stored securely in Netlify environment variables
const NETLIFY_PROXY_URL = "/.netlify/functions/groq-proxy";

// Legacy functions - kept for compatibility but now use backend
export function setGroqApiKey(key) {
  console.log("Note: API key is now managed securely by the backend. No need to set it here.");
}

export function getGroqApiKey() {
  return "backend-managed"; // API key is no longer exposed to frontend
}

export function hasGroqApiKey() {
  return true; // Backend always has the key if configured
}

// Supported Groq models
export const GROQ_MODELS = [
  "mixtral-8x7b-32768",
  "llama2-70b-4096",
  "gemma-7b-it"
];

export const DEFAULT_MODEL = "mixtral-8x7b-32768";

// System prompts for different use cases
export const SYSTEM_PROMPTS = {
  general: "You are a helpful AI assistant for Timzee Tech Hub. Provide clear, concise, and accurate responses.",
  contentIdeas: "You are a content creation assistant. Generate creative ideas for blog posts, videos, and social media content related to technology.",
  codeHelper: "You are an expert programmer. Help users with coding questions, debugging, and best practices.",
  community: "You are a community manager. Help with community engagement strategies and moderation guidelines.",
  seo: "You are an SEO expert. Help optimize content for search engines with keywords and structure.",
  writing: "You are a professional writer. Help improve writing clarity, grammar, and engagement."
};

// Save a prompt template for reuse
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

// Load prompt templates
export async function loadPromptTemplates(userId = null, isPublic = true) {
  let query = supabase.from("ai_prompts").select("*");
  
  if (isPublic) {
    query = query.eq("is_public", true);
  } else if (userId) {
    query = query.eq("user_id", userId);
  }
  
  const result = await query.order("created_at", { ascending: false });
  return result.data || [];
}

// Create a conversation
export async function createConversation(userId, title = "New Chat") {
  return supabase.from("ai_conversations").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    model: DEFAULT_MODEL,
    created_at: new Date().toISOString()
  }).select().single();
}

// Get conversation history
export async function getConversationHistory(conversationId) {
  const result = await supabase
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return result.data || [];
}

// Save a message to history
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

// Call Groq API via secure backend proxy
export async function callGroqAPI({
  messages = [],
  systemPrompt = SYSTEM_PROMPTS.general,
  model = DEFAULT_MODEL,
  temperature = 0.7,
  maxTokens = 1024,
  onStream = null
} = {}) {
  // Build message array with system prompt
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages
    ],
    temperature,
    max_tokens: maxTokens,
    stream: !!onStream
  };

  try {
    // Use backend proxy instead of direct API call
    const response = await fetch(NETLIFY_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    
    // Handle streaming or direct response
    if (onStream) {
      // For streaming, call the callback
      const content = data.message || data.choices?.[0]?.message?.content || "";
      onStream({ content });
      return { content, usage: data.usage };
    }

    // Return non-streaming response
    return {
      content: data.message || data.choices?.[0]?.message?.content || "",
      usage: data.usage,
      model: data.model
    };
  } catch (error) {
    console.error("Groq API call failed:", error);
    throw error;
  }
}

// Generate content with Groq
export async function generateContent({
  prompt,
  systemPrompt = SYSTEM_PROMPTS.contentIdeas,
  model = DEFAULT_MODEL,
  onStream = null
} = {}) {
  return callGroqAPI({
    messages: [{ role: "user", content: prompt }],
    systemPrompt,
    model,
    maxTokens: 2048,
    onStream
  });
}

// Chat with history
export async function chat({
  conversationId = null,
  userId = null,
  message,
  systemPrompt = SYSTEM_PROMPTS.general,
  model = DEFAULT_MODEL,
  onStream = null
} = {}) {
  let conversation = null;
  let history = [];

  if (conversationId) {
    history = await getConversationHistory(conversationId);
    conversation = { id: conversationId };
  }

  // Prepare messages array
  const messages = history
    .filter(msg => msg.role === "user" || msg.role === "assistant")
    .slice(-20) // Keep last 20 messages for context
    .map(msg => ({
      role: msg.role,
      content: msg.content
    }));

  messages.push({ role: "user", content: message });

  // Get response from Groq
  const response = await callGroqAPI({
    messages,
    systemPrompt,
    model,
    onStream
  });

  const responseContent = typeof response === "string" ? response : response.content;
  const tokensUsed = typeof response === "string" ? 0 : response.tokensUsed;

  // Save to database
  if (conversationId && userId) {
    await saveMessage(conversationId, userId, "user", message, 0);
    await saveMessage(conversationId, userId, "assistant", responseContent, tokensUsed);
  }

  return responseContent;
}

// Generate post ideas
export async function generatePostIdeas({ topic, count = 5 } = {}) {
  const prompt = `Generate ${count} creative blog post ideas about "${topic}" for a tech community. 
  Format as a numbered list with title and brief description.`;
  
  return generateContent({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.contentIdeas
  });
}

// Generate SEO optimized title and meta
export async function generateSEO({ topic, currentTitle = "", currentContent = "" } = {}) {
  const prompt = `Generate SEO-optimized title, meta description, and 5 relevant keywords for a post about "${topic}".
  ${currentTitle ? `Current title: "${currentTitle}"` : ""}
  ${currentContent ? `Content preview: "${currentContent.slice(0, 200)}"` : ""}
  
  Format as JSON: { "title": "...", "metaDescription": "...", "keywords": ["..."] }`;
  
  return generateContent({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.seo
  });
}

// Improve writing
export async function improveWriting({ text, style = "professional" } = {}) {
  const prompt = `Improve this ${style} writing for clarity, engagement, and grammar:
  
  "${text}"
  
  Return only the improved text without explanation.`;
  
  return generateContent({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.writing
  });
}

// Help with code
export async function helpWithCode({ code, question, language = "javascript" } = {}) {
  const prompt = `I have a ${language} code question: ${question}
  
  Code:
  \`\`\`${language}
  ${code}
  \`\`\`
  
  Provide a helpful explanation or solution.`;
  
  return generateContent({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.codeHelper,
    maxTokens: 2048
  });
}

// Moderation check using AI
export async function checkModerationAI({ text, category = "content" } = {}) {
  const prompt = `Check if this ${category} violates community guidelines. Respond with JSON:
  { "safe": boolean, "reason": "explanation", "severity": "low|medium|high" }
  
  Text: "${text}"`;
  
  try {
    const response = await generateContent({
      prompt,
      systemPrompt: "You are a content moderation AI. Be strict but fair."
    });
    
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { safe: true, reason: "Could not parse response", severity: "low" };
  } catch (error) {
    console.error("Moderation check error:", error);
    return { safe: true, reason: "Moderation check failed", severity: "low" };
  }
}

export default {
  setGroqApiKey,
  getGroqApiKey,
  hasGroqApiKey,
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
  checkModerationAI,
  GROQ_MODELS,
  DEFAULT_MODEL,
  SYSTEM_PROMPTS
};
