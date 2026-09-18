const { createClient } = require("@supabase/supabase-js");
const { requireRole, roleFromUser } = require("./_lib/auth-role.js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

const ALLOWED_ACTIONS = {
  promote_to_admin: "admin",
  promote_to_super: "super",
  demote_to_admin: "admin",
  remove_admin: "user"
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse(500, { error: "Server misconfigured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireRole(supabase, token, ["super"], "Only super admins can change admin roles.");
  if (guard.error) return jsonResponse(403, { error: guard.error });

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid request body." }); }

  const { userId, action } = payload;
  if (!userId || !action || !ALLOWED_ACTIONS[action]) return jsonResponse(400, { error: "Missing or invalid userId/action." });
  if (userId === guard.user.id && action !== "promote_to_super") return jsonResponse(400, { error: "You cannot change your own admin role. Ask another super admin." });

  const nextRole = ALLOWED_ACTIONS[action];
  const { data: authTarget, error: authTargetError } = await supabase.auth.admin.getUserById(userId);
  if (authTargetError || !authTarget?.user) return jsonResponse(404, { error: "User not found." });

  const targetProfile = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const currentTargetRole = targetProfile.data?.role || roleFromUser(authTarget.user);

  if (nextRole !== "super" && currentTargetRole === "super") {
    const { data: allUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return jsonResponse(500, { error: "Unable to verify super admin count." });
    const ids = (allUsers?.users || []).map((user) => user.id);
    let superCount = 0;
    if (ids.length) {
      const { data: profiles } = await supabase.from("profiles").select("id,role").in("id", ids);
      const roles = new Map((profiles || []).map((profile) => [profile.id, profile.role]));
      superCount = (allUsers?.users || []).filter((user) => (roles.get(user.id) || roleFromUser(user)) === "super").length;
    }
    if (superCount <= 1) return jsonResponse(400, { error: "Cannot remove the last super admin." });
  }

  const { data, error } = await supabase.from("profiles").update({ role: nextRole, updated_at: new Date().toISOString() }).eq("id", userId).select("id,display_name,username,role,updated_at").single();
  if (error) return jsonResponse(400, { error: error.message });

  try {
    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { ...(authTarget.user.app_metadata || {}), role: nextRole },
    });
  } catch {
    return jsonResponse(500, { error: "Role changed in profile but auth metadata synchronization failed." });
  }

  return jsonResponse(200, { profile: data });
};
