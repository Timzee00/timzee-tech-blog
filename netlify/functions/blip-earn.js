"use strict";
// Blip Earn Phase A: invitation attribution only; cash, airtime and withdrawals remain disabled.
// All database access uses a server-owned Supabase service role; never expose this key in a page.
const { createClient } = require("@supabase/supabase-js");
const { randomBytes } = require("node:crypto");
const { getUserWithTrustedRole, requireRole } = require("./_lib/auth-role.js");

const CODE = /^BL[0-9A-F]{12}$/;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};
const response = (statusCode, body) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body)
});
function client() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
function bearer(event) {
  const value = event.headers?.authorization || event.headers?.Authorization || "";
  if (!/^Bearer\s+[^\s]{12,3000}$/.test(value)) return null;
  return value.replace(/^Bearer\s+/,"");
}
function safeReason(error) {
  const message = String(error?.message || "");
  const allowed = [
    "Enter a valid referral code",
    "New referrals are paused",
    "Referral target has been reached",
    "Only recently created, verified accounts can apply a code",
    "Referral attribution requires completed adult onboarding",
    "The code cannot be applied to this account"
  ];
  return allowed.includes(message) ? message : "We couldn't complete this referral request. Please try again.";
}
async function programState(db) {
  const { data, error } = await db.rpc("blip_referral_program_status");
  if (error || !data || typeof data !== "object") {
    const issue = new Error("Referral database configuration is unavailable.");
    issue.code = "UNAVAILABLE";
    throw issue;
  }
  return data;
}
function publicState(state) {
  return {
    enabled: state.enabled === true,
    accepting_referrals: state.accepting_referrals === true,
    target_reached: state.target_reached === true,
    milestone_size: 10,
    cash_payouts_enabled: false,
    status_message: state.accepting_referrals
      ? "Invitations are open. Cash rewards have not launched."
      : state.target_reached ? "The referral member target has been reached."
      : "New referral invitations are currently paused."
  };
}
async function identify(db, event, requireSuper = false) {
  const token = bearer(event);
  if (!token) return null;
  const result = requireSuper
    ? await requireRole(db, token, ["super"], "Super administrator access required.")
    : await getUserWithTrustedRole(db, token);
  return result.error ? null : result;
}
async function myInfo(db, actor, program) {
  const owner = actor.user.id;
  const [codeResult, pendingResult, qualifiedResult, rejectedResult] = await Promise.all([
    db.from("blip_referral_codes").select("code").eq("owner_id",owner).maybeSingle(),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("referrer_id",owner).eq("status","pending"),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("referrer_id",owner).eq("status","qualified"),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("referrer_id",owner).eq("status","rejected")
  ]);
  if ([codeResult,pendingResult,qualifiedResult,rejectedResult].some(r=>r.error)) {
    throw new Error("Unable to retrieve your referral summary.");
  }
  return {
    program: publicState(program),
    code: codeResult.data?.code || null,
    referrals: {
      pending: pendingResult.count || 0,
      qualified: qualifiedResult.count || 0,
      rejected: rejectedResult.count || 0
    },
    payouts_available: false,
    qualification_note: "Referral qualification and cash rewards have not launched. These are pending invitations, not earnings."
  };
}
async function issueCode(db, actor, program) {
  const userId = actor.user.id;
  const present = await db.from("blip_referral_codes").select("code").eq("owner_id",userId).maybeSingle();
  if (present.error) throw new Error("Your referral code could not be checked.");
  if (present.data?.code) return present.data.code;
  if (!program.accepting_referrals) {
    const err = new Error("New referrals are currently paused."); err.status = 409; throw err;
  }
  if (!actor.user.email_confirmed_at && !actor.user.confirmed_at) {
    const err = new Error("Verify your email before creating an invitation link."); err.status = 403; throw err;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = "BL" + randomBytes(6).toString("hex").toUpperCase();
    // Database locks the referral switch and goal before minting a new code.
    const {data:issued,error} = await db.rpc("blip_referral_issue_code",{
      p_user:userId,p_code:code
    });
    if (!error && typeof issued==="string" && CODE.test(issued)) return issued;
    if (error?.code === "55000") {
      const e=new Error("New referral invitations are paused or the member goal has been met.");
      e.status=409;throw e;
    }
    if (error?.code === "42501") {
      const e=new Error("A verified, active account is required to invite friends.");
      e.status=403;throw e;
    }
    if (error?.code !== "23505") {
      throw new Error("Unable to create your referral code.");
    }
    // Unique owner or code collision. Re-read for racing tabs before retrying.
    const previous = await db.from("blip_referral_codes").select("code").eq("owner_id",userId).maybeSingle();
    if (previous.data?.code) return previous.data.code;
  }
  throw new Error("Please retry generating your code.");
}
async function claimCode(db, actor, input) {
  const code = String(input?.code || "").trim().toUpperCase();
  if (!CODE.test(code)) return response(400,{error:"Enter a valid referral code."});
  const limit = await db.rpc("blip_referral_consume_attempt",{p_user:actor.user.id});
  if (limit.error) return response(503,{error:"Referral security checks are unavailable."});
  if (limit.data !== true) return response(429,{error:"Today's referral code attempt limit has been reached. Try again tomorrow."});
  const result = await db.rpc("blip_referral_claim",{p_user:actor.user.id,p_code:code});
  if (result.error) return response(result.error.code==="55000"?409:400,{error:safeReason(result.error)});
  return response(200,{status:result.data?.status || "pending",message: result.data?.status==="already_recorded"
    ? "A referral was already linked to your account."
    : "Referral code saved for review. No cash reward has been earned."});
}
async function adminState(db, actor, program) {
  const [record, claims, pending, approved] = await Promise.all([
    db.from("blip_referral_settings").select("enabled,target_activated_members,updated_at,updated_by").eq("singleton",true).single(),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("status","pending"),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("status","qualified")
  ]);
  if ([record,claims,pending,approved].some(r=>r.error)) throw new Error("Founder referral controls unavailable.");
  return {
    program: { ...publicState(program),...record.data,
      activated_members:Number(program.activated_members || 0),
      recent_signins_30d:Number(program.recent_signins_30d || 0)
    },
    tracking: {
      attributed:claims.count || 0,
      pending:pending.count || 0,
      qualified:approved.count || 0
    },
    funding: {cash_rewards_enabled:false,payouts_enabled:false}
  };
}
exports.handler = async (event) => {
  if (!["GET","POST"].includes(event.httpMethod)) return response(405,{error:"Method not allowed."});
  const db = client();
  if (!db) return response(503,{error:"Referral service is not configured."});
  try {
    if (event.httpMethod === "GET") {
      const view = String(event.queryStringParameters?.view||"public").toLowerCase();
      if (!["public","mine","admin"].includes(view)) return response(400,{error:"Unknown view."});
      const program = await programState(db);
      if (view === "public") return response(200,{program:publicState(program)});
      const actor = await identify(db,event,view==="admin");
      if (!actor) return response(403,{error:view==="admin"?"Super Admin access required.":"Sign in to see your referrals."});
      if (view === "admin") return response(200,await adminState(db,actor,program));
      return response(200,await myInfo(db,actor,program));
    }
    if ((event.body || "").length > 2000) return response(413,{error:"Request is too large."});
    if (!/^application\/json(?:;|$)/i.test(event.headers?.["content-type"]||event.headers?.["Content-Type"]||""))
      return response(415,{error:"Send application/json."});
    let input;
    try {input=JSON.parse(event.body||"{}");} catch {return response(400,{error:"Invalid JSON."});}
    if (!input || Array.isArray(input) || typeof input !== "object") return response(400,{error:"Invalid request."});
    const action = String(input.action||"");
    if (!["issue-code","claim","admin-config"].includes(action)) return response(400,{error:"Unknown action."});
    const actor = await identify(db,event,action==="admin-config");
    if (!actor) return response(403,{error:action==="admin-config"?"Super Admin access required.":"Sign in to use referrals."});
    if (action === "admin-config") {
      if (typeof input.enabled !== "boolean" || !Number.isSafeInteger(input.target) ||
          input.target<0 || input.target>10000000 || typeof input.reason!=="string" ||
          input.reason.trim().length<12 || input.reason.length>500)
        return response(400,{error:"Set a valid status, member target and reason of 12–500 characters."});
      const {data,error} = await db.rpc("blip_referral_admin_save", {
        p_actor:actor.user.id,p_enabled:input.enabled,p_target:input.target,p_reason:input.reason.trim()
      });
      if (error) return response(403,{error:"Unable to save referral settings."});
      return response(200,{program:{...publicState(data),activated_members:data.activated_members,
        recent_signins_30d:data.recent_signins_30d,target_activated_members:data.target_activated_members}});
    }
    const program = await programState(db);
    if (action === "issue-code") {
      try { return response(200,{code:await issueCode(db,actor,program)}); }
      catch (e) {return response(e.status||503,{error:e.message||"Code unavailable."});}
    }
    return await claimCode(db,actor,input);
  } catch (error) {
    console.error("Blip Earn request failed",error?.code||"unavailable");
    return response(503,{error:"Blip Earn is temporarily unavailable. Please try again later."});
  }
};
