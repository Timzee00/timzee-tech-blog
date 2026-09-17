const { createClient } = require("@supabase/supabase-js");
const { requireRole } = require("./_lib/auth-role.js");

const jsonResponse = (statusCode, payload) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(payload) });
function getBearerToken(event) { const header = event.headers?.authorization || event.headers?.Authorization || ""; return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : ""; }

const ACTIONS = {
  posts: { publish: { table: "posts", mutation: { status: "published" } }, unpublish: { table: "posts", mutation: { status: "draft" } }, delete: { table: "posts", mutation: null } },
  comments: { approve: { table: "comments", mutation: { status: "approved" } }, hide: { table: "comments", mutation: { status: "pending" } }, delete: { table: "comments", mutation: null } },
  discussion_messages: { delete: { table: "discussion_messages", mutation: null } },
  marketplace_items: { hide: { table: "marketplace_items", mutation: { is_available: false } }, delete: { table: "marketplace_items", mutation: null } },
  videos: { hide: { table: "videos", mutation: { is_public: false } }, delete: { table: "videos", mutation: null } },
  novels: { hide: { table: "novels", mutation: { status: "paused" } }, delete: { table: "novels", mutation: null } }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse(500, { error: "Server misconfigured." });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const guard = await requireRole(supabase, getBearerToken(event), ["moderator", "admin", "super"], "Only moderators or admins can access this.");
  if (guard.error) return jsonResponse(guard.error === "Missing auth token." || guard.error === "Invalid auth token." ? 401 : 403, { error: guard.error });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON body." }); }
  const action = String(payload.action || ""), type = String(payload.type || ""), id = String(payload.id || "");
  const definition = ACTIONS[type]?.[action];
  if (!definition || !id) return jsonResponse(400, { error: "Invalid action, content type, or id." });

  try {
    const result = definition.mutation
      ? await supabase.from(definition.table).update(definition.mutation).eq("id", id).select("id").maybeSingle()
      : await supabase.from(definition.table).delete().eq("id", id).select("id").maybeSingle();
    if (result.error) return jsonResponse(400, { error: result.error.message || "Moderation action failed." });
    if (!result.data) return jsonResponse(404, { error: "Content item was not found or was already removed." });

    const audit = await supabase.from("moderation_audit").insert({ moderator_id: guard.user.id, moderator_role: guard.role, action, content_type: type, content_id: id, details: { source: "moderate-content" } });
    return jsonResponse(200, { ok: true, auditRecorded: !audit.error });
  } catch (error) {
    console.error("Moderation handler error:", error);
    return jsonResponse(500, { error: "Failed to process moderation action." });
  }
};
