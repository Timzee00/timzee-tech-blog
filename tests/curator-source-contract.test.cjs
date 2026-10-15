const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Test the actual curator data-layer functions without connecting to the
// production database. The browser module imports Supabase at runtime, so
// this fixture injects a fake query builder rather than creating real records.
function curatorFixture() {
  const source = readFileSync(join(__dirname,"../assets/js/curator.js"),"utf8")
    .replace(/^\s*import\s+\{\s*supabase\s*\}\s+from\s+["']\.\/supabase\.js["'];?\s*$/gm,"")
    .replace(/\bexport\s+(?=(?:async\s+)?function|const|let)/g,"");
  const requests = [];
  const builder = () => ({
    insert(payload) { requests.push({ method: "insert", payload }); return this; },
    update(payload) { requests.push({ method: "update", payload }); return this; },
    eq() { return this; },
    select() { return this; },
    async single() { return { data: { id: "synthetic-source" }, error: null }; }
  });
  const supabase = { from(name) {
    assert.equal(name,"curator_sources");
    return builder();
  }};
  const funcs = new Function("supabase",source+
    "\nreturn { createCuratorSource,updateCuratorSource };")(supabase);
  return { ...funcs, requests };
}
test("adding an RSS source supplies the database-required url AND feed_url", async () => {
  const fixture=curatorFixture();
  await fixture.createCuratorSource({
    name:"Fixture RSS",feed_url:"https://example.org/rss.xml",enabled:true
  });
  assert.equal(fixture.requests.length,1);
  const {payload}=fixture.requests[0];
  assert.equal(payload.url,"https://example.org/rss.xml");
  assert.equal(payload.feed_url,payload.url);
  assert.equal(payload.enabled,true);
});
test("editing a source does not leave stale URL values", async () => {
  const fixture=curatorFixture();
  await fixture.updateCuratorSource("synthetic-source",{
    feed_url:"https://example.org/new.xml",enabled:false
  });
  const {payload}=fixture.requests[0];
  assert.equal(payload.url,"https://example.org/new.xml");
  assert.equal(payload.feed_url,payload.url);
  assert.equal(payload.enabled,false);
  assert.equal(payload.is_active,false);
});
test("scout respects both enabled switches before contacting remote sources", () => {
  const code=readFileSync(join(__dirname,"../netlify/functions/scout-news.js"),"utf8");
  assert.match(code,/settingsResult\.data\?\.enabled === true/);
  assert.match(code,/settingsResult\.data\?\.scout_enabled !== false/);
});
