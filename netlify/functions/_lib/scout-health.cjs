function summarizeScoutHealth({ settings, activeSources = 0, importedArticles = 0, job } = {}) {
  const enabled = settings?.enabled === true && settings?.scout_enabled !== false;
  const lastRunAt = job?.last_started_at || settings?.scout_last_run_at || null;
  const lastStatus = job?.last_result?.status || settings?.scout_last_status || "never_run";
  const failure = lastStatus === "failed" || (
    job?.last_failed_at && (!job?.last_succeeded_at ||
      new Date(job.last_failed_at).getTime() > new Date(job.last_succeeded_at).getTime()));
  return {
    enabled, activeSources: Math.max(0, Number(activeSources) || 0),
    importedArticles: Math.max(0, Number(importedArticles) || 0),
    lastRunAt, lastStatus,
    lastRunFailed: Boolean(failure), runCount: Number(job?.run_count || 0),
    configurationChecks: {
      scoutEnabled: enabled,
      hasSources: Number(activeSources) > 0
    }
  };
}
module.exports = { summarizeScoutHealth };
