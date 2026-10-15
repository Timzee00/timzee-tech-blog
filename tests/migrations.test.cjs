const test = require("node:test");
const { readFileSync, readdirSync } = require("node:fs");
const { parse } = require("pgsql-parser");

for (const file of readdirSync("supabase/migrations").filter(file => file.endsWith(".sql"))) {
  test(`PostgreSQL syntax: ${file}`, async () => {
    // Syntax only. Does not establish schema replayability or validate RLS.
    await parse(readFileSync(`supabase/migrations/${file}`, "utf8"));
  });
}
