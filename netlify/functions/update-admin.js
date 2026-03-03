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

async function requireSuper(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };
  const role = await resolveRole(supabase, data.user);
  if (role !== "super") return { error: "Only super admins can access this." };
  return { user: data.user, role };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Server misconfigured." });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const { action, userId, password } = payload;
  if (!action || !userId) {
    return jsonResponse(400, { error: "Missing action or userId." });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireSuper(supabase, token);
  if (guard.error) {
    return jsonResponse(403, { error: guard.error });
  }

  if (action === "reset_password") {
    if (!password) return jsonResponse(400, { error: "Password is required." });
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password
    });
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { ok: true });
  }

  if (action === "delete") {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return jsonResponse(400, { error: error.message });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(400, { error: "Unknown action." });
};
