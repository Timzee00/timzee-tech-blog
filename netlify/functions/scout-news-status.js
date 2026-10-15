// Read-only scout diagnostics; accessible to active Admins and Super Admins only.
// Never report credentials, feed URLs, tokens, or arbitrary upstream errors.
const { createClient } = require("@supabase/supabase-js");
const { requireRole } = require("./_lib/auth-role.js");
const { summarizeScoutHealth } = require("./_lib/scout-health.cjs");

const json = (code, value) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(value)
});

exports.handler = async (event = {}) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Use GET for read-only scout status." });
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const token = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return json(401, { error: "Authentication required." });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return json(503, { error: "Scout server Supabase configuration is incomplete; check Functions environment variables." });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const guard = await requireRole(supabase, token, ["admin", "super"], "Administrator permissions required.");
  if (guard.error) return json(403, { error: guard.error });

  const [settings, sources, drafts, job] = await Promise.all([
    supabase.from("curator_settings")
      .select("enabled,scout_enabled,scout_last_run_at,scout_last_status").maybeSingle(),
    supabase.from("curator_sources").select("id", { head: true, count: "exact" }).eq("enabled", true),
    supabase.from("curator_posts").select("id", { head: true, count: "exact" }),
    supabase.from("system_job_status")
      .select("last_started_at,last_succeeded_at,last_failed_at,run_count,last_result")
      .eq("job_name", "curator-scout").maybeSingle()
  ]);
  if ([settings,sources,drafts,job].some(result => result.error)) {
    console.warn("Scout health query failed.");
    return json(503, { error: "Scout status could not be read. Check server logs and database permissions." });
  }
  return json(200, summarizeScoutHealth({
    settings: settings.data,
    activeSources: sources.count,
    importedArticles: drafts.count,
    job: job.data
  }));
};
