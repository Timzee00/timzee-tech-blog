/**
 * Scheduled maintenance for production.
 *
 * The browser should not be responsible for publishing scheduled content,
 * expiring transient records, or fanning
 * out system notifications. Those responsibilities live behind the database
 * RPC and server-side maintenance and run without an admin opening the site.
 */
const { createClient } = require("@supabase/supabase-js");

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
};

exports.config = {
  schedule: "*/5 * * * *"
};
