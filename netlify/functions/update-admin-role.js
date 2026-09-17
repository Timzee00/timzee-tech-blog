const { createClient } = require("@supabase/supabase-js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

function resolveRole(user) {
  return user?.app_metadata?.role || "user";
}

const ALLOWED_ACTIONS = {
  promote_to_admin: "admin",
  promote_to_super: "super",
  demote_to_admin: "admin",
  remove_admin: "user"
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Server misconfigured." });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return jsonResponse(401, { error: "Missing auth token." });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: callerData, error: callerError } = await supabase.auth.getUser(token);
  if (callerError || !callerData?.user) {
    return jsonResponse(401, { error: "Invalid auth token." });
  }

  const callerRole = resolveRole(callerData.user);
  if (callerRole !== "super") {
    return jsonResponse(403, { error: "Only super admins can change admin roles." });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid request body." });
  }

  const { userId, action } = payload;
  if (!userId || !action || !ALLOWED_ACTIONS[action]) {
    return jsonResponse(400, { error: "Missing or invalid userId/action." });
  }

  if (userId === callerData.user.id && action !== "promote_to_super") {
    return jsonResponse(400, { error: "You cannot change your own admin role. Ask another super admin." });
  }

  const nextRole = ALLOWED_ACTIONS[action];

  if (nextRole !== "super") {
    const { data: authTarget } = await supabase.auth.admin.getUserById(userId);
    if (authTarget?.user && resolveRole(authTarget.user) === "super") {
      const { data: allUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) {
        return jsonResponse(500, { error: "Unable to verify super admin count." });
      }
      const superCount = (allUsers?.users || []).filter((user) => resolveRole(user) === "super").length;
      if (superCount <= 1) {
        return jsonResponse(400, { error: "Cannot remove the last super admin." });
      }
    }
  }

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(userId);
  if (authUserError || !authUserData?.user) {
    return jsonResponse(404, { error: "User not found." });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ role: nextRole, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id,display_name,username,role,updated_at")
    .single();

  if (error) {
    return jsonResponse(400, { error: error.message });
  }

  try {
    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { ...(authUserData.user.app_metadata || {}), role: nextRole },
      user_metadata: { ...(authUserData.user.user_metadata || {}), role: nextRole }
    });
  } catch (syncError) {
    return jsonResponse(500, { error: "Role changed in profile but auth metadata synchronization failed." });
  }

  return jsonResponse(200, { profile: data });
};