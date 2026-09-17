const { createClient } = require("@supabase/supabase-js");

const CHAT_BUCKET = "chat-media";
const CHAT_PREFIX = "direct-messages/";
const SIGNED_URL_TTL = 60 * 60;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    },
    body: JSON.stringify(body)
  };
}

function getBearerToken(event) {
  const header = event?.headers?.authorization || event?.headers?.Authorization || "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

function normalizePath(value) {
  if (typeof value !== "string") return "";
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (_) {
    return "";
  }
  decoded = decoded.replace(/^\/+/, "");
  if (!decoded || decoded.length > 1024) return "";
  if (decoded.includes("..") || decoded.includes("\\") || /[\u0000-\u001f]/.test(decoded)) return "";
  return decoded;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(503, { error: "Storage signing is not configured." });
  }

  const accessToken = getBearerToken(event);
  if (!accessToken) {
    return jsonResponse(401, { error: "Authentication required." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const path = normalizePath(payload.path);
  if (!path.startsWith(CHAT_PREFIX)) {
    return jsonResponse(400, { error: "Invalid chat media path." });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    const user = userData?.user;
    if (userError || !user) {
      return jsonResponse(401, { error: "Your session is invalid or expired." });
    }

    const ownerId = path.split("/")[1] || "";
    let authorized = ownerId === user.id;

    const { data: message, error: messageError } = await supabase
      .from("direct_messages")
      .select("thread_id,sender_id,recipient_id")
      .eq("media_path", path)
      .limit(1)
      .maybeSingle();

    if (messageError) {
      console.error("Chat media authorization lookup failed:", messageError);
      return jsonResponse(503, { error: "Unable to verify chat media access." });
    }

    if (message) {
      const isParticipant = message.sender_id === user.id || message.recipient_id === user.id;
      if (isParticipant) authorized = true;

      if (!authorized && message.thread_id) {
        const { data: membership, error: membershipError } = await supabase
          .from("chat_members")
          .select("user_id")
          .eq("thread_id", message.thread_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (membershipError) {
          console.error("Chat media membership lookup failed:", membershipError);
          return jsonResponse(503, { error: "Unable to verify chat media access." });
        }
        authorized = !!membership;
      }
    }

    if (!authorized) {
      return jsonResponse(403, { error: "You do not have access to this chat media." });
    }

    const { data, error: signError } = await supabase.storage
      .from(CHAT_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);

    if (signError || !data?.signedUrl) {
      console.error("Chat media signing failed:", signError);
      return jsonResponse(500, { error: "Unable to create a secure media URL." });
    }

    return jsonResponse(200, {
      signedUrl: data.signedUrl,
      path,
      expiresIn: SIGNED_URL_TTL
    });
  } catch (error) {
    console.error("Chat media signing exception:", error);
    return jsonResponse(500, { error: "Unexpected storage signing failure." });
  }
};
