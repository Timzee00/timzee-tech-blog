const { createClient } = require("@supabase/supabase-js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

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
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: "Invalid auth token." });
  }
  let role = userData.user.user_metadata?.role || userData.user.app_metadata?.role;
  if (!role) {
    const profileResult = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileResult.data?.role) {
      role = profileResult.data.role;
    }
  }
  if (role !== "super") {
    return jsonResponse(403, { error: "Only super admins can create admins." });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const { email, password, displayName, username } = payload;
  if (!email) {
    return jsonResponse(400, { error: "Email is required." });
  }

  const now = new Date().toISOString();
  const normalizedUsername = username || (email ? email.split("@")[0] : "");

  const findExistingUser = async () => {
    // Try direct auth.users lookup (service role should allow).
    try {
      const authLookup = await supabase
        .from("auth.users")
        .select("id, email")
        .eq("email", email)
        .maybeSingle();
      if (authLookup.data?.id) return authLookup.data;
    } catch (error) {
      // Ignore and fall back.
    }

    // Try profile lookup by username.
    if (normalizedUsername) {
      const profileLookup = await supabase
        .from("profiles")
        .select("id, email")
        .eq("username", normalizedUsername)
        .maybeSingle();
      if (profileLookup.data?.id) return profileLookup.data;
    }

    // Fallback: scan user list (limited).
    let page = 1;
    const perPage = 200;
    while (page <= 5) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const match = (data?.users || []).find(
        (user) => user.email?.toLowerCase() === email.toLowerCase()
      );
      if (match) return match;
      if ((data?.users || []).length < perPage) break;
      page += 1;
    }
    return null;
  };

  const promoteExisting = async (userId, existingUser = {}) => {
    const currentMeta = existingUser.user_metadata || {};
    const currentAppMeta = existingUser.app_metadata || {};
    const updatedMeta = {
      ...currentMeta,
      role: "admin",
      display_name: displayName || currentMeta.display_name || email.split("@")[0],
      username: normalizedUsername || currentMeta.username
    };
    const updatedAppMeta = {
      ...currentAppMeta,
      role: "admin"
    };
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: updatedMeta,
      app_metadata: updatedAppMeta
    });
    if (error) {
      return jsonResponse(400, { error: error.message });
    }

    await supabase
      .from("profiles")
      .upsert({
        id: userId,
        display_name: updatedMeta.display_name,
        username: updatedMeta.username,
        email,
        role: "admin",
        updated_at: now
      })
      .select();

    return jsonResponse(200, { ok: true, userId, mode: "promoted" });
  };

  const existingUser = await findExistingUser();
  if (existingUser && !password) {
    return promoteExisting(existingUser.id, existingUser);
  }

  if (!password) {
    return jsonResponse(400, { error: "Password required to create a new admin." });
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      role: "admin"
    },
    user_metadata: {
      role: "admin",
      display_name: displayName || email.split("@")[0],
      username: normalizedUsername
    }
  });

  if (createError) {
    if (createError.message?.toLowerCase().includes("already")) {
      const existing = await findExistingUser();
      if (existing) {
        return promoteExisting(existing.id, existing);
      }
    }
    return jsonResponse(400, { error: createError.message });
  }

  await supabase
    .from("profiles")
    .upsert({
      id: created.user.id,
      display_name: displayName || email.split("@")[0],
      username: normalizedUsername,
      email,
      role: "admin",
      created_at: now
    })
    .select();

  return jsonResponse(200, { ok: true, userId: created.user.id, mode: "created" });
};
