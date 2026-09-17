const { createClient } = require("@supabase/supabase-js");

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async () => {
  const startedAt = Date.now();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(503, {
      status: "degraded",
      service: "timzee-tech-blog",
      reason: "database configuration missing"
    });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const [{ error: dbError }, { data: job, error: jobError }, legacyMedia] = await Promise.all([
      supabase.from("profiles").select("id", { head: true, count: "exact" }).limit(1),
      supabase.from("system_job_status").select("last_succeeded_at,last_failed_at,last_error,run_count").eq("job_name", "automation-maintenance").maybeSingle(),
      supabase
        .from("direct_messages")
        .select("id", { head: true, count: "exact" })
        .or("media_url.ilike.%/storage/v1/object/public/media/direct-messages/%,media_url.ilike.%/storage/v1/object/sign/media/direct-messages/%")
    ]);

    const dbOk = !dbError;
    const automationOk = !jobError && !!job?.last_succeeded_at && new Date(job.last_succeeded_at).getTime() >= Date.now() - (15 * 60 * 1000);
    const legacyCount = legacyMedia.error ? null : Number(legacyMedia.count || 0);
    const privateChatMediaOk = legacyCount === 0;
    const status = dbOk && automationOk && privateChatMediaOk ? "ok" : "degraded";

    return jsonResponse(status === "ok" ? 200 : 503, {
      status,
      service: "timzee-tech-blog",
      version: process.env.COMMIT_REF || "unknown",
      deploy_id: process.env.DEPLOY_ID || null,
      database: dbOk ? "ok" : "error",
      automation: automationOk ? "ok" : "stale_or_unavailable",
      private_chat_media: privateChatMediaOk ? "ok" : "legacy_public_objects_pending",
      legacy_public_chat_media_count: legacyCount,
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return jsonResponse(503, {
      status: "degraded",
      service: "timzee-tech-blog",
      version: process.env.COMMIT_REF || "unknown",
      database: "error",
      automation: "unknown",
      private_chat_media: "unknown",
      legacy_public_chat_media_count: null,
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt
    });
  }
};
