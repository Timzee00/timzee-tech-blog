// A regular HTTP entrypoint for authenticated Super Admins.
// Netlify scheduled functions cannot be invoked directly by URL.
// The same scout workflow is reused, but scheduling headers are stripped
// so no public request can claim to be an internal cron invocation.
function manualEvent(event = {}) {
  const httpMethod = String(event.httpMethod || "GET").toUpperCase();
  const headers = { ...(event.headers || {}) };
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "x-nf-event") delete headers[key];
  }
  // Never permit HTTP callers to forge Netlify's scheduled next_run body.
  // Manual runs use a bearer token, not a cron execution marker.
  return { ...event, httpMethod, headers, body: "{}" };
}
exports.manualEvent = manualEvent;
exports.handler = async (event, context) => {
  const safe = manualEvent(event);
  if (safe.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Allow": "POST", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Use POST to run the curator." }) };
  }
  // scout-news checks the bearer token against current, trusted profile
  // roles. Only a Super Admin may trigger a manual run.
  const { handler } = require("./scout-news.js");
  return handler(safe, context);
};
