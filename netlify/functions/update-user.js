const { createClient } = require("@supabase/supabase-js");
const { requireRole, roleFromUser } = require("./_lib/auth-role.js");

const jsonResponse = (statusCode, payload) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
const allowedTiers = new Set(["standard", "pro", "elite"]);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse(500, { error: "Server misconfigured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireRole(supabase, token, ["admin", "super"], "Only admins can access this.");
  if (guard.error) return jsonResponse(guard.error === "Missing auth token." || guard.error === "Invalid auth token." ? 401 : 403, { error: guard.error });

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid request body." }); }

  const userId = payload.userId;
  const action = payload.action;
  if (!userId || !action) return jsonResponse(400, { error: "Missing userId or action." });

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(userId);
  if (authUserError || !authUserData?.user) return jsonResponse(404, { error: "User not found." });

  const requesterRole = guard.role;
  const requesterId = guard.user?.id || null;
  const targetProfileRole = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const targetRole = targetProfileRole.data?.role || roleFromUser(authUserData.user);

  if (action === "suspend" && requesterId === userId) return jsonResponse(400, { error: "You cannot suspend your own account." });
  if (targetRole === "super" && requesterRole !== "super") return jsonResponse(403, { error: "Only super admins can modify super accounts." });
  if (targetRole === "admin" && requesterRole !== "super") return jsonResponse(403, { error: "Only super admins can modify admin accounts." });

  const profileResult = await supabase.from("profiles").select("id, display_name, verification_tier, is_verified, verified_at, account_status").eq("id", userId).maybeSingle();
  const existingProfile = profileResult.data || null;
  const now = new Date().toISOString();
  const updates = { updated_at: now };
  const incomingTier = allowedTiers.has(payload.verificationTier) ? payload.verificationTier : null;
  const currentTier = existingProfile?.verification_tier || "standard";
  const tierValue = incomingTier || currentTier;

  if (action === "verify") {
    updates.is_verified = true; updates.verified_at = existingProfile?.verified_at || now; updates.verification_tier = tierValue;
  } else if (action === "unverify") {
    updates.is_verified = false; updates.verified_at = null; updates.verification_tier = "standard";
  } else if (action === "suspend") {
    updates.account_status = "suspended";
  } else if (action === "activate") {
    updates.account_status = "active";
  } else if (action === "set_tier") {
    updates.verification_tier = tierValue;
    if (tierValue === "standard") { updates.is_verified = false; updates.verified_at = null; }
    else { updates.is_verified = true; updates.verified_at = existingProfile?.verified_at || now; }
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
    const { data, error } = await supabase.from("profiles").update(updates).eq("id", userId).select().single();
    if (error) return jsonResponse(400, { error: error.message });

    if (["verify", "unverify", "set_tier"].includes(action)) {
      const notification = await supabase.rpc("emit_user_notification", {
        p_user_id: userId,
        p_type: "verification_status",
        p_title: action === "unverify" ? "Verification removed" : "Verification status updated",
        p_body: action === "verify"
          ? "Your account has been verified."
          : action === "unverify"
            ? "Your verified status has been removed."
            : `Your verification tier is now ${updates.verification_tier}.`,
        p_link: "/profile.html",
        p_data: { user_id: userId, action, verification_tier: updates.verification_tier || null, actor_id: guard.user.id }
      });
      if (notification.error) console.warn("Verification notification failed:", notification.error);
    }

    return jsonResponse(200, { profile: data });
  }

  const displayName = authUserData.user.user_metadata?.display_name || authUserData.user.email?.split("@")[0] || "Member";
  const trustedRole = roleFromUser(authUserData.user);
  const insertPayload = { id: userId, display_name: displayName, role: trustedRole, created_at: now, ...updates };
  const { data, error } = await supabase.from("profiles").insert(insertPayload).select().single();
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { profile: data });
};
