// Read-only, budget-capped smoke load for a verified staging deployment.
// Usage: node scripts/staging-load-probe.mjs <preview-origin> [concurrency] [count]
// Never intentionally writes, logs in, or targets the production origin.
import { pathToFileURL } from "node:url";

const ROUTES = ["/", "/login.html", "/marketplace.html", "/videos.html", "/health"];
export function stagingOrigin(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("Supply only the staging origin");
  const local = url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname);
  const preview = url.protocol === "https:" &&
    /^(?:deploy-preview-\d+|[a-z0-9][a-z0-9-]*)--timzee-tech-blog\.netlify\.app$/i.test(url.hostname);
  if (!local && !preview) throw Error("Refusing to load-test production or unapproved hosts. Use an isolated staging preview.");
  return url.origin;
}
export function boundedWorkload(rawConcurrency = 5, rawRequests = 50) {
  const concurrency = Number(rawConcurrency), count = Number(rawRequests);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20 ||
      !Number.isSafeInteger(count) || count < 1 || count > 400) {
    throw Error("Concurrency must be 1–20 and request count must be 1–400");
  }
  return { concurrency, count };
}
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.ceil(sorted.length * p) - 1];
}
export async function runProbe(origin, workload, request = fetch) {
  const samples = [], failures = [];
  const started = performance.now();
  let next = 0;
  async function worker() {
    while (next < workload.count) {
      const index = next++;
      const route = ROUTES[index % ROUTES.length];
      const t0 = performance.now();
      try {
        const response = await request(origin + route, {
          method: "GET", cache: "no-store", redirect: "error",
          signal: AbortSignal.timeout(12000)
        });
        await response.arrayBuffer();
        samples.push({ route, status: response.status, ms: performance.now() - t0 });
        if (!response.ok) failures.push({ route, status: response.status });
      } catch (error) {
        failures.push({ route, error: String(error.message || error) });
        samples.push({ route, status: 0, ms: performance.now() - t0 });
      }
    }
  }
  await Promise.all(Array.from({ length: workload.concurrency }, () => worker()));
  const ms = samples.map(v => v.ms);
  const seconds = Math.max(.001, (performance.now() - started) / 1000);
  return {
    environment: "staging smoke only; not a 100k-user capacity certificate",
    requests: samples.length,
    concurrency: workload.concurrency,
    seconds: Math.round(seconds*100)/100,
    requests_per_second: Math.round(samples.length/seconds*100)/100,
    failure_count: failures.length,
    error_rate: Math.round(failures.length/samples.length*10000)/100,
    latency_ms: { p50: Math.round(percentile(ms,.5)), p95: Math.round(percentile(ms,.95)), p99: Math.round(percentile(ms,.99)) },
    failures: failures.slice(0,20)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [originArg, concurrency = "5", count = "50"] = process.argv.slice(2);
  try {
    const origin = stagingOrigin(originArg || "");
    const workload = boundedWorkload(Number(concurrency), Number(count));
    const result = await runProbe(origin, workload);
    console.log(JSON.stringify(result,null,2));
    if (result.error_rate > 1) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
