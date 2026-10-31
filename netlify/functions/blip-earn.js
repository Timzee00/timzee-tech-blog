"use strict";
// Blip Earn Phase A: invitation attribution only; cash, airtime and withdrawals remain disabled.
// All database access uses a server-owned Supabase service role; never expose this key in a page.
const { createClient } = require("@supabase/supabase-js");
const { randomBytes } = require("node:crypto");
const { getUserWithTrustedRole, requireRole } = require("./_lib/auth-role.js");

const CODE = /^BL[0-9A-F]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      ? "Invitations are open. ₦1,000 manual rewards require ten staff-approved genuine referrals and available founder funding."
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
    qualification_note: "Referral qualification needs 3 distinct days of genuine participation and staff review. Manual rewards are separate from automatic payments.",
    ...(await rewardSummary(db, owner))
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
  const [record, claims, pending, approved, history] = await Promise.all([
    db.from("blip_referral_settings").select("enabled,target_activated_members,updated_at,updated_by").eq("singleton",true).single(),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("status","pending"),
    db.from("blip_referrals").select("referred_user_id",{head:true,count:"exact"}).eq("status","qualified"),
    db.rpc("blip_referral_recent_changes",{p_actor:actor.user.id})
  ]);
  if ([record,claims,pending,approved,history].some(r=>r.error)) throw new Error("Founder referral controls unavailable.");
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
    funding: {cash_rewards_enabled:false,payouts_enabled:false},
    history: Array.isArray(history.data) ? history.data : [],
    ...(await founderRewardSummary(db,actor))
  };
}

function requestError(error, fallback) {
  const message=String(error?.message||"");
  const permitted=[
    "Three distinct activity days are required for qualification",
    "Active verified adult onboarding required",
    "Referral already reviewed; never double approve",
    "Only requested unpaid rewards may be marked paid",
    "Only consenting paid recipients may be published",
    "A valid public username is required",
    "Founder reward cap reached",
    "Only an HTTPS winners-channel URL is allowed",
    "Choose a currently verified active staff account",
    "Configure a verified Blipmood staff chat before enabling manual rewards",
    "Referral does not exist",
    "Reward record unavailable"
  ];
  return permitted.includes(message) ? message : fallback;
}
function validUuid(value) {return typeof value==="string" && UUID.test(value);}
async function rewardSummary(db,owner) {
  const [awards, config] = await Promise.all([
    db.from("blip_manual_rewards")
      .select("id,milestone_no,amount_naira,status,delivery_method,requested_at,paid_at,public_consent_at,published_at")
      .eq("referrer_id",owner).order("milestone_no",{ascending:false}).limit(50),
    db.from("blip_reward_controls")
      .select("enabled,max_awards,official_chat_account").eq("singleton",true).single()
  ]);
  if(awards.error||config.error)throw Error("Unable to load your manual reward summary.");
  let officialChat = null;
  if(config.data?.official_chat_account){
    const staff=await db.from("profiles")
      .select("id,username,role,account_status,is_verified")
      .eq("id",config.data.official_chat_account).maybeSingle();
    if(!staff.error && staff.data?.is_verified===true &&
      staff.data.account_status==="active" && ["super","admin"].includes(staff.data.role)) {
      officialChat={
        username:staff.data.username,
        link:"/chat.html?user="+encodeURIComponent(staff.data.id)
      };
    }
  }
  return {
    reward_program:{
      manual_funding_open:config.data?.enabled===true,
      amount_per_ten:1000, milestone_size:10,
      automatic_payouts_enabled:false,
      status_note:"Any available award is personally paid by Blipmood's founder after verification."
    },
    awards:Array.isArray(awards.data)?awards.data:[],
    official_chat:officialChat
  };
}
async function founderRewardSummary(db,actor) {
  const [controls,reviewQueue,rewardQueue,winners] = await Promise.all([
    db.from("blip_reward_controls")
      .select("enabled,max_awards,official_chat_account,winners_channel_url,updated_at")
      .eq("singleton",true).single(),
    db.rpc("blip_reward_review_queue",{p_actor:actor.user.id,p_limit:25}),
    db.rpc("blip_reward_admin_queue",{p_actor:actor.user.id,p_limit:30}),
    db.rpc("blip_reward_winners",{p_limit:30})
  ]);
  if([controls,reviewQueue,rewardQueue,winners].some(r=>r.error))
    throw Error("Unable to load reward moderation controls.");
  let officialName="";
  if(controls.data?.official_chat_account){
    const q=await db.from("profiles").select("username").eq("id",controls.data.official_chat_account).maybeSingle();
    if(!q.error) officialName=q.data?.username||"";
  }
  return {
    reward_controls:{
      enabled:controls.data?.enabled===true,
      max_awards:controls.data?.max_awards||0,
      official_staff_username:officialName,
      winners_channel_url:controls.data?.winners_channel_url||"",
      updated_at:controls.data?.updated_at
    },
    reviews:Array.isArray(reviewQueue.data)?reviewQueue.data:[],
    reward_queue:Array.isArray(rewardQueue.data)?rewardQueue.data:[],
    winners:Array.isArray(winners.data)?winners.data:[]
  };
}
async function rewardAction(db,actor,input) {
  const action=input.action;
  const superOnly=new Set(["admin-rewards-config","admin-review","admin-mint","admin-paid","admin-publish"]);
  if(superOnly.has(action) && actor.role!=="super")return response(403,{error:"Super Admin required."});
  if(action==="admin-rewards-config"){
    const cap=input.max_awards;
    if(typeof input.enabled!=="boolean" || !Number.isSafeInteger(cap) || cap<0 || cap>1000 ||
       (input.enabled && cap===0) || typeof input.reason!=="string" ||
       input.reason.trim().length<12 || input.reason.length>500 ||
       typeof input.chat_username!=="string" || input.chat_username.length>90 ||
       typeof input.channel_url!=="string" || input.channel_url.length>350)
      return response(400,{error:"Enter the separate reward switch, funding cap, optional staff contact and a reason."});
    const {data,error}=await db.rpc("blip_reward_admin_config",{
      p_actor:actor.user.id,p_enabled:input.enabled,p_max_awards:cap,
      p_chat_username:input.chat_username,p_channel_url:input.channel_url,
      p_reason:input.reason.trim()
    });
    if(error)return response(400,{error:requestError(error,"Reward controls were not saved.")});
    return response(200,{config:data});
  }
  if(action==="admin-review"){
    if(!validUuid(input.referred_id)||!["qualified","rejected"].includes(input.decision)||
      typeof input.reason!=="string" || input.reason.trim().length<12 || input.reason.length>500)
      return response(400,{error:"Choose a valid referral, decision and detailed review reason."});
    const {data,error}=await db.rpc("blip_referral_review",{
      p_actor:actor.user.id,p_referred:input.referred_id,
      p_decision:input.decision,p_reason:input.reason.trim()
    });
    if(error)return response(error.code==="55000"?409:400,{
      error:requestError(error,"Referral review failed. Confirm member eligibility and activity.")});
    return response(200,{review:data});
  }
  if(action==="admin-mint"){
    if(typeof input.owner_username!=="string"||!/^[a-z0-9_]{3,32}$/i.test(input.owner_username.replace(/^@/,"")))
      return response(400,{error:"Enter an existing @username."});
    const lookup=await db.from("profiles").select("id")
      .ilike("username",input.owner_username.trim().replace(/^@/,"")).maybeSingle();
    if(lookup.error||!lookup.data?.id)return response(404,{error:"Member not found."});
    const {data,error}=await db.rpc("blip_reward_mint",{p_actor:actor.user.id,p_owner:lookup.data.id});
    if(error)return response(400,{error:"Unable to create eligible capped milestones."});
    return response(200,{mint:data});
  }
  if(!validUuid(input.award_id))return response(400,{error:"Invalid reward reference."});
  if(action==="member-request"){
    if(!["bank","airtime"].includes(input.method)||typeof input.public_consent!=="boolean")
      return response(400,{error:"Choose bank or airtime and confirm your public winner preference."});
    const {data,error}=await db.rpc("blip_reward_member_request",{
      p_user:actor.user.id,p_award:input.award_id,
      p_method:input.method,p_consent:input.public_consent
    });
    if(error)return response(400,{error:"Reward request could not be recorded."});
    return response(200,{award:data});
  }
  if(action==="member-consent"){
    if(typeof input.public_consent!=="boolean")
      return response(400,{error:"A consent choice is required."});
    const {data,error}=await db.rpc("blip_reward_member_consent",{
      p_user:actor.user.id,p_award:input.award_id,p_consent:input.public_consent
    });
    if(error)return response(400,{error:"Could not change winner-list consent."});
    return response(200,{consent:data});
  }
  if(action==="admin-paid"){
    if(typeof input.note!=="string"||input.note.trim().length<12||input.note.length>500)
      return response(400,{error:"Confirm the manual transfer with a 12–500 character note. Do not enter account numbers."});
    const {data,error}=await db.rpc("blip_reward_mark_paid",{
      p_actor:actor.user.id,p_award:input.award_id,p_note:input.note.trim()
    });
    if(error)return response(409,{error:requestError(error,"Only a pending unpaid request can be marked paid.")});
    return response(200,{payment:data});
  }
  if(action==="admin-publish"){
    if(typeof input.publish!=="boolean")return response(400,{error:"Publication choice required."});
    const {data,error}=await db.rpc("blip_reward_publish_winner",{
      p_actor:actor.user.id,p_award:input.award_id,p_publish:input.publish
    });
    if(error)return response(409,{error:requestError(error,"Winner must be paid and have explicitly opted in.")});
    return response(200,{publication:data});
  }
  return response(400,{error:"Unsupported reward action."});
}

exports.handler = async (event) => {
  if (!["GET","POST"].includes(event.httpMethod)) return response(405,{error:"Method not allowed."});
  const db = client();
  if (!db) return response(503,{error:"Referral service is not configured."});
  try {
    if (event.httpMethod === "GET") {
      const view = String(event.queryStringParameters?.view||"public").toLowerCase();
      if (!["public","mine","admin","winners"].includes(view)) return response(400,{error:"Unknown view."});
      if(view==="winners"){
        const [winners,config]=await Promise.all([
          db.rpc("blip_reward_winners",{p_limit:30}),
          db.from("blip_reward_controls").select("winners_channel_url").eq("singleton",true).single()
        ]);
        if(winners.error||config.error)return response(503,{error:"Winners list unavailable."});
        return response(200,{winners:Array.isArray(winners.data)?winners.data:[],
          channel_url:config.data?.winners_channel_url||null});
      }
      const program = await programState(db);
      if (view === "public") return response(200,{program:publicState(program)});
      const actor = await identify(db,event,view==="admin");
      if (!actor) return response(403,{error:view==="admin"?"Super Admin access required.":"Sign in to see your referrals."});
      if (view === "admin") return response(200,await adminState(db,actor,program));
      return response(200,await myInfo(db,actor,program));
    }
    if ((event.body || "").length > 3000) return response(413,{error:"Request is too large."});
    if (!/^application\/json(?:;|$)/i.test(event.headers?.["content-type"]||event.headers?.["Content-Type"]||""))
      return response(415,{error:"Send application/json."});
    let input;
    try {input=JSON.parse(event.body||"{}");} catch {return response(400,{error:"Invalid JSON."});}
    if (!input || Array.isArray(input) || typeof input !== "object") return response(400,{error:"Invalid request."});
    const action = String(input.action||"");
    if (!["issue-code","claim","admin-config","admin-rewards-config","admin-review","admin-mint","admin-paid","admin-publish","member-request","member-consent"].includes(action)) return response(400,{error:"Unknown action."});
    const isAdminAction=action==="admin-config"||action.startsWith("admin-");
    const actor = await identify(db,event,isAdminAction);
    if (!actor) return response(403,{error:isAdminAction?"Super Admin access required.":"Sign in to use referrals."});
    if(!["issue-code","claim","admin-config"].includes(action)){
      return await rewardAction(db,actor,input);
    }
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
