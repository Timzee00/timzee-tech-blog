const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Run the actual handler with a fake database/provider; never mutate a live project.
function loadHandler(name, supabase, overrides = {}) {
  const filename = resolve(__dirname, "../netlify/functions", `${name}.js`);
  const realRequire = createRequire(filename);
  const sandbox = {
    exports: {}, Buffer, AbortSignal, console: { error() {}, warn() {}, log() {} },
    process: { env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only", GROQ_API_KEY: "test-only", ...overrides.env } },
    fetch: overrides.fetch || (() => { throw new Error("Unexpected network request"); }),
    require: id => id === "@supabase/supabase-js" ? { createClient: () => supabase } : realRequire(id)
  };
  vm.runInNewContext(readFileSync(filename, "utf8"), sandbox, { filename });
  return sandbox.exports.handler;
}

function query(result = { data: null, error: null }, calls = []) {
  const builder = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  for (const method of ["select", "eq", "in", "or", "order", "limit", "update", "insert", "upsert", "delete", "single", "maybeSingle"]) {
    builder[method] = (...args) => { calls.push([method, ...args]); return builder; };
  }
  return builder;
}
const event = body => ({ httpMethod: "POST", headers: { authorization: "Bearer test-session" }, body: JSON.stringify(body) });
module.exports = { loadHandler, query, event };
