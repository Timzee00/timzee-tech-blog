const { createClient } = require("@supabase/supabase-js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

async function resolveRole(supabase, user) {
  let role = user?.user_metadata?.role;
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

async function requireAdmin(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };
  const role = await resolveRole(supabase, data.user);
  if (role !== "admin" && role !== "super") {
    return { error: "Only admins can access this." };
  }
  return { user: data.user, role };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Server misconfigured." });
  }

  const params = event.queryStringParameters || {};
  const rawSearch = params.search ? String(params.search) : "";
  const search = rawSearch.toLowerCase().trim();
  const perPage = Math.min(Number.parseInt(params.perPage || "200", 10) || 200, 200);
  const maxPages = Math.min(Number.parseInt(params.maxPages || "5", 10) || 5, 10);
  const requestedPage = Number.parseInt(params.page || "0", 10);

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireAdmin(supabase, token);
  if (guard.error) {
    return jsonResponse(403, { error: guard.error });
  }

  let users = [];
  let hasMore = false;
  let page = 1;

  if (requestedPage > 0 && !search) {
    page = requestedPage;
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      return jsonResponse(400, { error: error.message });
    }
    users = data?.users || [];
    hasMore = users.length >= perPage;
  } else {
    page = 1;
    while (page <= maxPages) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        return jsonResponse(400, { error: error.message });
      }
      const batch = data?.users || [];
      users = users.concat(batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    hasMore = false;
    page = 1;
  }

  if (search) {
    users = users.filter((user) => {
      const email = user.email?.toLowerCase() || "";
      const displayName = user.user_metadata?.display_name?.toLowerCase() || "";
      const username = user.user_metadata?.username?.toLowerCase() || "";
      return email.includes(search) || displayName.includes(search) || username.includes(search);
    });
  }

  const userIds = users.map((user) => user.id);
  let profilesById = {};
  if (userIds.length) {
    const profileResult = await supabase
      .from("profiles")
      .select(
        "id, display_name, username, avatar_url, is_verified, verification_tier, account_status, verified_at, is_featured, is_staff_pick, points, level"
      )
      .in("id", userIds);
    if (!profileResult.error && profileResult.data) {
      profilesById = profileResult.data.reduce((acc, profile) => {
        acc[profile.id] = profile;
        return acc;
      }, {});
    }
  }

  const result = users.map((user) => {
    const profile = profilesById[user.id] || {};
    return {
      id: user.id,
      email: user.email,
      role: profile.role || user.user_metadata?.role || "user",
      display_name:
        profile.display_name ||
        user.user_metadata?.display_name ||
        user.email?.split("@")[0] ||
        "Member",
      username: profile.username || user.user_metadata?.username || "",
      avatar_url: profile.avatar_url || "",
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      is_verified: profile.is_verified || false,
      verification_tier: profile.verification_tier || "standard",
      account_status: profile.account_status || "active",
      verified_at: profile.verified_at || null,
      is_featured: profile.is_featured || false,
      is_staff_pick: profile.is_staff_pick || false,
      points: profile.points || 0,
      level: profile.level || ""
    };
  });

  return jsonResponse(200, { users: result, page, hasMore });
};
