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

const allowedTiers = new Set(["standard", "pro", "elite"]);

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
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireAdmin(supabase, token);
  if (guard.error) {
    return jsonResponse(403, { error: guard.error });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid request body." });
  }

  const userId = payload.userId;
  const action = payload.action;
  if (!userId || !action) {
    return jsonResponse(400, { error: "Missing userId or action." });
  }

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(
    userId
  );
  if (authUserError || !authUserData?.user) {
    return jsonResponse(404, { error: "User not found." });
  }

  const requesterRole = guard.role;
  const requesterId = guard.user?.id || null;
  const targetRole = await resolveRole(supabase, authUserData.user);

  if (action === "suspend" && requesterId && requesterId === userId) {
    return jsonResponse(400, { error: "You cannot suspend your own account." });
  }

  if (targetRole === "super" && requesterRole !== "super") {
    return jsonResponse(403, { error: "Only super admins can modify super accounts." });
  }

  if (targetRole === "admin" && requesterRole !== "super") {
    return jsonResponse(403, { error: "Only super admins can modify admin accounts." });
  }

  const profileResult = await supabase
    .from("profiles")
    .select("id, display_name, verification_tier, is_verified, verified_at, account_status")
    .eq("id", userId)
    .maybeSingle();

  const existingProfile = profileResult.data || null;
  const now = new Date().toISOString();
  const updates = { updated_at: now };

  const incomingTier = allowedTiers.has(payload.verificationTier)
    ? payload.verificationTier
    : null;
  const currentTier = existingProfile?.verification_tier || "standard";
  const tierValue = incomingTier || currentTier;

  if (action === "verify") {
    updates.is_verified = true;
    updates.verified_at = existingProfile?.verified_at || now;
    updates.verification_tier = tierValue;
  } else if (action === "unverify") {
    updates.is_verified = false;
    updates.verified_at = null;
    updates.verification_tier = "standard";
  } else if (action === "suspend") {
    updates.account_status = "suspended";
  } else if (action === "activate") {
    updates.account_status = "active";
  } else if (action === "set_tier") {
    const nextTier = tierValue;
    updates.verification_tier = nextTier;
    if (nextTier === "standard") {
      updates.is_verified = false;
      updates.verified_at = null;
    } else {
      updates.is_verified = true;
      updates.verified_at = existingProfile?.verified_at || now;
    }
  } else if (action === "feature") {
    updates.is_featured = true;
  } else if (action === "unfeature") {
    updates.is_featured = false;
  } else if (action === "staff") {
    updates.is_staff_pick = true;
  } else if (action === "unstaff") {
    updates.is_staff_pick = false;
  } else {
    return jsonResponse(400, { error: "Unknown action." });
  }

  if (existingProfile) {
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select()
      .single();
    if (error) {
      return jsonResponse(400, { error: error.message });
    }
    return jsonResponse(200, { profile: data });
  }

  const displayName =
    authUserData.user.user_metadata?.display_name ||
    authUserData.user.email?.split("@")[0] ||
    "Member";

  const insertPayload = {
    id: userId,
    display_name: displayName,
    role: authUserData.user.user_metadata?.role || authUserData.user.app_metadata?.role || "user",
    created_at: now,
    ...updates
  };

  const { data, error } = await supabase
    .from("profiles")
    .insert(insertPayload)
    .select()
    .single();
  if (error) {
    return jsonResponse(400, { error: error.message });
  }

  return jsonResponse(200, { profile: data });
};
