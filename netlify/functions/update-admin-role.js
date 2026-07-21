const { createClient } = require("@supabase/supabase-js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

async function resolveRole(supabase, user) {
  let role = user?.user_metadata?.role || user?.app_metadata?.role;
  if (!role && user?.id) {
    const profileResult = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileResult.data?.role) {
      role = profileResult.data.role;
    }
  }
  return role || "user";
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

  const callerRole = await resolveRole(supabase, callerData.user);
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

  // Safety net: never allow the last super admin to be demoted/removed.
  if (nextRole !== "super") {
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (targetProfile?.role === "super") {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "super");
      if ((count || 0) <= 1) {
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
    .select()
    .single();

  if (error) {
    return jsonResponse(400, { error: error.message });
  }

  // Keep JWT metadata in sync too, since some RLS policies still read role
  // from there — avoids the exact stale-role inconsistency found earlier.
  try {
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { ...(authUserData.user.user_metadata || {}), role: nextRole }
    });
  } catch (syncError) {
    // Non-fatal: profile role is the source of truth; metadata sync is best-effort.
  }

  return jsonResponse(200, { profile: data });
};
