const { parseJsonObject } = require("./_lib/request.js");
const { createClient } = require("@supabase/supabase-js");
const { requireRole, roleFromUser } = require("./_lib/auth-role.js");

const jsonResponse = (statusCode, payload) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(payload) });
// Verification grants and level changes belong exclusively to the audited review endpoint.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse(500, { error: "Server misconfigured." });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireRole(supabase, token, ["admin", "super"], "Only admins can access this.");
  if (guard.error) return jsonResponse(guard.error === "Missing auth token." || guard.error === "Invalid auth token." ? 401 : 403, { error: guard.error });

  const parsed = parseJsonObject(event);
  if (parsed.error) return jsonResponse(parsed.statusCode, { error: parsed.error });
  const payload = parsed.payload;

  const userId = payload.userId;
  const action = payload.action;
  if (action === "verify" || action === "set_tier") {
    if (guard.role !== "super") return jsonResponse(403, {error:"Only super administrators can manage verification directly."});
    const tier = String(payload.verificationTier || "").trim().toLowerCase();
    const reason = String(payload.reason || "").trim();
    if (!["silver","gold","platinum"].includes(tier) || reason.length < 25 || reason.length > 1800) {
      return jsonResponse(400, {error:"Choose Silver, Gold or Platinum and document the evidence and decision (25–1800 characters). Business verification requires formal organization review."});
    }
    if (typeof payload.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.userId)) return jsonResponse(400,{error:"Invalid user."});
    const {data,error}=await supabase.rpc("admin_manage_verified_identity",{
      p_actor:guard.user.id,p_user:payload.userId,p_tier:tier,p_reason:reason
    });
    if(error)return jsonResponse(409,{error:error.message || "Verification action could not be completed."});
    return jsonResponse(200,{profile:data});
  }
  if (!userId || !action) return jsonResponse(400, { error: "Missing userId or action." });

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(userId);
  if (authUserError || !authUserData?.user) return jsonResponse(404, { error: "User not found." });

  if(action==="unverify"){
    const reason=String(payload.reason||"").trim();
    if(reason.length<25||reason.length>1800)
      return jsonResponse(400,{error:"Please enter a documented reason (25–1800 characters)."});
    const revocation=await supabase.rpc("revoke_verified_identity",{
      p_user:userId,p_actor:guard.user.id,p_reason:reason
    });
    if(revocation.error)return jsonResponse(409,{error:revocation.error.message});
    return jsonResponse(200,{profile:revocation.data});
  }
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


  if (action === "suspend") {
    updates.account_status = "suspended";
  } else if (action === "activate") {
    updates.account_status = "active";
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

    return jsonResponse(200, { profile: data });
  }

  const displayName = authUserData.user.user_metadata?.display_name || authUserData.user.email?.split("@")[0] || "Member";
  const trustedRole = roleFromUser(authUserData.user);
  const insertPayload = { id: userId, display_name: displayName, role: trustedRole, created_at: now, ...updates };
  const { data, error } = await supabase.from("profiles").insert(insertPayload).select().single();
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { profile: data });
};
