// Pure, read-only curator diagnostics. The scheduled worker itself cannot run
// while a Netlify site is paused; a stale result is not the same as success.
function summarizeScoutHealth({ settings, activeSources = 0, importedArticles = 0, job,
  lastSourceFetchAt = null, now = Date.now() } = {}) {
  const enabled = settings?.enabled === true && settings?.scout_enabled !== false;
  const sources = Math.max(0, Number(activeSources) || 0);
  const lastRunAt = job?.last_started_at || settings?.scout_last_run_at || null;
  const lastSuccessfulRunAt = job?.last_succeeded_at || null;
  const lastStatus = job?.last_result?.status || settings?.scout_last_status || "never_run";
  const failedAt = Date.parse(job?.last_failed_at || "");
  const succeededAt = Date.parse(lastSuccessfulRunAt || "");
  const failure = lastStatus === "failed" || (
    Number.isFinite(failedAt) && (!Number.isFinite(succeededAt) || failedAt > succeededAt));
  const referenceAt = Date.parse(lastRunAt || "");
  const validTimestamp = Number.isFinite(referenceAt) && referenceAt <= now + 5 * 60_000;
  const ageMinutes = validTimestamp ? Math.max(0, Math.floor((now - referenceAt) / 60_000)) : null;
  const maxAgeMinutes = 180; // hourly schedule plus bounded scheduler delays
  const stale = enabled && sources > 0 && ageMinutes !== null && ageMinutes > maxAgeMinutes;
  const status = !enabled ? "disabled" : !sources ? "no_sources" :
    failure ? "failed" : ageMinutes === null ? "never_run" :
    stale ? "stale" : "healthy";
  return {
    enabled, activeSources: sources,
    importedArticles: Math.max(0, Number(importedArticles) || 0),
    lastRunAt, lastSuccessfulRunAt, lastSourceFetchAt, lastStatus,
    lastRunFailed: Boolean(failure),
    lastRunStale: stale,
    runAgeMinutes: ageMinutes,
    expectedMaxAgeMinutes: maxAgeMinutes,
    operationalStatus: status,
    needsAttention: enabled && status !== "healthy",
    runCount: Number(job?.run_count || 0),
    configurationChecks: {
      scoutEnabled: enabled,
      hasSources: sources > 0
    }
  };
}
module.exports = { summarizeScoutHealth };
