/**
 * Scheduled maintenance for production.
 *
 * The browser should not be responsible for publishing scheduled content,
 * expiring transient records, or fanning
 * out system notifications. Those responsibilities live behind the database
 * RPC and server-side maintenance and run without an admin opening the site.
 */
const { createClient } = require("@supabase/supabase-js");
const { maybeRefreshFeedCandidates } = require("./_lib/feed-refresh.cjs");

// One-time media migration and orphan deletion do not belong in this recurring
// publishing job. A truncated reference scan cannot prove an object is unused.
// Legacy public media needs a separately reviewed migration with a full inventory,
// conditional message updates and verified backups; this job never deletes it.

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Scheduled automation is not configured.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await supabase.rpc("process_automation_tick");
  if (error) {
    console.error("Production automation tick failed:", error);
    throw error;
  }

  console.log("Production automation tick completed:", { automation: data });
  // Identity renewals and privacy retention are server-owned and idempotent.
  // A paused host delays reminders, but expired badges also disappear instantly
  // in the frontend when their server-issued expiry timestamp passes.
  const verification=await supabase.rpc("process_verification_maintenance");
  if(verification.error){
    console.error("Verification expiry/profile-visit cleanup failed:",verification.error);
    throw verification.error;
  }
  console.log("Verification lifecycle maintenance completed:",verification.data);

  // One quiet in-app digest per UTC day, only for super admins who opt in
  // and only when action is actually required. The database guarantees
  // idempotency, even if two scheduled workers overlap or retry.
  const digest=await supabase.rpc("process_founder_operations_digest");
  if(digest.error){
    console.error("Founder operations digest failed:",digest.error.code||"unknown");
    throw digest.error;
  }
  if(digest.data?.notified)console.log("Founder operations review notifications:",digest.data.notified);

  // Expensive shared ranking snapshots are opt-in until the database function
  // and consumption path have passed isolated staging tests.
  try {
    const ranking = await maybeRefreshFeedCandidates(supabase, process.env);
    if (!ranking.skipped) console.log("Feed candidate refresh completed:", ranking);
  } catch (error) {
    console.error("Feed candidate refresh failed:", error);
    throw error; // Scheduled function logs/alerts must reveal genuine failures.
  }
};

exports.config = {
  schedule: "*/5 * * * *"
};
