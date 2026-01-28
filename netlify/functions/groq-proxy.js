/**
 * Groq API Proxy Function
 * Handles Groq API calls server-side to keep API key secure
 * Prevents XSS attacks from stealing your API key
 * 
 * Usage: POST to /.netlify/functions/groq-proxy
 * Body: { "message": "your message here" }
 */

export default async (req, context) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  try {
    // Parse request body
    const { message } = JSON.parse(req.body || "{}");

    // Validate input
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Message is required and must be a non-empty string." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Get API key from environment (secure, not exposed to frontend)
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
      console.error("GROQ_API_KEY environment variable not set");
      return new Response(
        JSON.stringify({ error: "Groq API key not configured on server" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Call Groq API
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "mixtral-8x7b-32768",
          messages: [
            {
              role: "user",
              content: message
            }
          ],
          max_tokens: 1024,
          temperature: 0.7
        })
      }
    );

    // Handle Groq API errors
    if (!groqResponse.ok) {
      const errorData = await groqResponse.json();
      console.error("Groq API error:", errorData);

      return new Response(
        JSON.stringify({
          error: `Groq API error: ${groqResponse.statusText}`,
          details: errorData
        }),
        {
          status: groqResponse.status,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Parse Groq response
    const data = await groqResponse.json();

    // Extract response text
    const responseText =
      data.choices?.[0]?.message?.content || "No response from AI";

    // Return success
    return new Response(
      JSON.stringify({
        success: true,
        message: responseText,
        model: data.model,
        usage: data.usage
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error("Groq proxy error:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to process request",
        message: error.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
