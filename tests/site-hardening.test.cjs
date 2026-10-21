
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const userCode = read("assets/js/user-preferences.js")
  .replace(/^\s*import[^\n]+\n/gm, "")
  .replace(/\bexport\s+/g, "");
const preferences = new Function(userCode + "\nreturn {mergePreferences, DEFAULT_USER_PREFERENCES, getPreference};")();
const asPlain = value => JSON.parse(JSON.stringify(value));

test("preference merging does not trust prototype keys or unknown options", () => {
 const payload = JSON.parse('{"__proto__":{"admin":true},"constructor":{"role":"super"},"appearance":{"__proto__":{"admin":true},"reduceMotion":"false","fontScale":"999","theme":"untrusted","highContrast":true},"notifications":{"messages":{"value":true},"replies":false},"unknown":{"run":true}}');
 const actual = preferences.mergePreferences(payload);
 assert.deepEqual(asPlain(actual.appearance), {
   reduceMotion:false,highContrast:true,theme:"system",fontScale:"100",contentDensity:"comfortable"
 });
 assert.equal(actual.notifications.messages,true);
 assert.equal(actual.notifications.replies,false);
 assert.equal(Object.prototype.hasOwnProperty.call(actual,"__proto__"),false);
 assert.equal(Object.prototype.hasOwnProperty.call(actual,"constructor"),false);
 assert.equal({}.admin,undefined);
});

test("preference merging never accepts arrays or malformed typed categories", () => {
 const wrong = preferences.mergePreferences({appearance:["dark"], feed:{defaultFeed:"__proto__",showRecommendations:"no"},chat:null});
 assert.equal(wrong.appearance.theme,"system");
 assert.equal(wrong.feed.defaultFeed,"for-you");
 assert.equal(wrong.feed.showRecommendations,true);
 assert.equal(wrong.chat.enterToSend,true);
 assert.equal(preferences.mergePreferences({appearance:{fontScale:"125"}}).appearance.fontScale,"125");
});

test("unique Supabase migrations are validated before production builds", () => {
 const files=fs.readdirSync(path.join(root,"supabase/migrations")).filter(x=>x.endsWith(".sql"));
 const versions=files.map(x=>x.match(/^(\d{14})_[a-z0-9_]+\.sql$/)?.[1]);
 assert.ok(versions.every(Boolean),"All migration filenames must be versioned");
 assert.equal(new Set(versions).size,files.length,"Duplicate migration versions");
 const pkg=JSON.parse(read("package.json"));
 assert.match(pkg.scripts.check,/validate-migration-versions\.mjs/);
});

test("viewport containment loads after design-system overrides", () => {
 const styles=read("assets/css/styles.css");
 const admin=read("assets/css/admin.css");
 const guard=read("assets/css/viewport-guard.css");
 const responsive=read("assets/css/responsive.css");
 assert.ok(styles.indexOf('viewport-guard.css')>styles.indexOf('design-system.css'));
 assert.ok(styles.indexOf('viewport-guard.css')>styles.indexOf('mobile-acceptance-fixes.css'));
 assert.match(admin,/viewport-guard\.css/);
 assert.ok(admin.indexOf("viewport-guard.css")>admin.indexOf("design-system.css"));
 assert.match(guard,/overflow-x: clip/);
 assert.match(guard,/overflow-x: auto/);
 assert.doesNotMatch(responsive,/html,\s*body\s*\{[^}]*overflow-x:\s*visible/s);
});

test("database validates preference payload size and object type", () => {
 const sql=read("supabase/migrations/20261017035000_user_preference_size.sql");
 assert.match(sql,/jsonb_typeof\(preferences\) = 'object'/);
 assert.match(sql,/octet_length\(preferences::text\) <= 65536/);
});

test("clearing preference cache never signs a member out or overwrites server settings", () => {
 const removed=[];
 const fakeStorage={removeItem:key=>removed.push(key)};
 const factory=new Function("localStorage", userCode+"\nreturn {clearLocalPreferences};");
 const result=factory(fakeStorage).clearLocalPreferences("demo-user");
 assert.equal(result,true);
 assert.deepEqual(removed,["timzee_user_preferences_v3:demo-user","timzee-ui-appearance"]);
 const page=read("assets/js/settings-page.js");
 assert.match(page,/clearLocalPreferences\(state\.user\.id\)/);
 assert.doesNotMatch(page,/clearLocalDataBtn"[\s\S]*?writeLocalPreferences\(state\.user\.id,mergePreferences\(\)\)/);
});

test("database execution grants are restricted to callable RPC functions", () => {
 const sql=read("supabase/migrations/20261017036000_internal_rpc_privilege_guard.sql");
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION/);
 assert.match(sql,/p\.prorettype='pg_catalog\.trigger'::regtype/);
 assert.match(sql,/forum_automod_reason/);
});
