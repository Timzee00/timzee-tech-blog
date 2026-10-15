// Netlify's legacy scheduled invocations contain a JSON body with next_run.
// Do not trust this shape in the public manual endpoint: that endpoint strips
// schedule headers and payload before forwarding to scout-news.
function isScheduledInvocation(event = {}) {
  const headers = event.headers || {};
  const marked = Object.entries(headers).some(([name,value])=>
    name.toLowerCase()==="x-nf-event" && String(value).toLowerCase()==="schedule");
  if (marked) return true;
  if (event.httpMethod && String(event.httpMethod).toUpperCase() !== "POST") return false;
  try {
    const payload = JSON.parse(event.body || "{}");
    return typeof payload.next_run === "string" &&
      Number.isFinite(Date.parse(payload.next_run)) &&
      !Array.isArray(payload);
  } catch { return false; }
}
module.exports = { isScheduledInvocation };
