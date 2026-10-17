const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
function stripExports(code){
 return code.replace(/^\s*import[\s\S]*?from\s*["'][^"']+["'];\s*$/gm,"")
  .replace(/^\s*import\s*["'][^"']+["'];\s*$/gm,"")
  .replace(/\bexport\s+(?=(?:async\s+)?function|const|class|let)/g,"");
}
const baseContext={};
vm.runInNewContext(stripExports(read("assets/js/user-preferences.js"))+
 "\nthis.DEFAULT_USER_PREFERENCES=DEFAULT_USER_PREFERENCES;",baseContext);
const ctx={DEFAULT_USER_PREFERENCES:baseContext.DEFAULT_USER_PREFERENCES,supabase:{}};
vm.runInNewContext(stripExports(read("assets/js/settings-advanced.js"))+
 "\nthis.validatePreferenceImport=validatePreferenceImport;",ctx);
const validate=ctx.validatePreferenceImport;
const asJSON=value=>JSON.parse(JSON.stringify(value));

test("preference imports restore only known and type-safe values",()=>{
 const parsed=validate({format:"timzee-preferences-v1",preferences:{
  appearance:{theme:"dark",fontScale:"125",reduceMotion:true,unknownOption:"secret"},
  chat:{compact:true,enterToSend:false},
  videos:{autoplay:false},
  unexpected:{admin:true},
  privacy:{showEmail:true}
 }});
 assert.deepEqual(asJSON(parsed),{
  appearance:{theme:"dark",fontScale:"125",reduceMotion:true},
  chat:{compact:true,enterToSend:false},
  videos:{autoplay:false}
 });
});
test("preference importer rejects unsupported enums, prototype fields and empty content",()=>{
 assert.throws(()=>validate(null),/Invalid preferences/);
 assert.throws(()=>validate({appearance:{theme:"untrusted",fontScale:"10000"}}),/No supported/);
 assert.throws(()=>validate({admin:{role:"super"}}),/No supported/);
 const data=JSON.parse('{"__proto__":{"isAdmin":true},"notifications":{"messages":"yes","mentions":true}}');
 const result=validate(data);
 assert.equal(result.notifications.mentions,true);
 assert.equal(result.notifications.messages,undefined);
 assert.equal({}.isAdmin,undefined);
});
test("settings mount precedes standard controls and autosave",()=>{
 const js=read("assets/js/settings-page.js");
 assert.match(js,/mountExtraSettings\(\);\s*mountAdvancedSettings\(\);/);
 assert.match(js,/initializeAdvancedSettings/);
 assert.match(js,/onImport:changes/);
 assert.match(js,/writeLocalPreferences\(state\.user\.id,state\.preferences\)/);
 assert.match(js,/saveUserPreferences\(state\.user\.id, preferences\)/);
});
test("advanced choices are backed by real server tables and scoped to user",()=>{
 const js=read("assets/js/settings-advanced.js");
 assert.match(js,/from\("community_user_interests"\)/);
 assert.match(js,/from\("chat_privacy"\)/);
 assert.match(js,/from\("community_feed_feedback"\)/);
 assert.match(js,/from\("user_content_feedback"\)/);
 assert.match(js,/\.eq\("user_id",uid\)/);
 assert.match(js,/user_id:uid/);
 assert.match(js,/max_rows_per_collection:500/);
 assert.doesNotMatch(js,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
});
test("account-wide appearance values are applied and honor device theme",()=>{
 const js=read("assets/js/theme-init.js");
 const prefs=read("assets/js/user-preferences.js");
 assert.match(js,/options\.theme === "system"/);
 assert.match(js,/fontSize = scale \+ "%"/);
 assert.match(js,/dataset\.contentDensity/);
 assert.match(js,/dataset\.highContrast/);
 assert.match(js,/dataset\.reduceMotion/);
 assert.match(prefs,/fontScale: "100"/);
 assert.match(prefs,/contentDensity: "comfortable"/);
});
test("recommendations, forum live updates and banners respect preferences",()=>{
 const forum=read("assets/js/community-forum.mjs");
 const notifications=read("assets/js/notification-popup.js");
 assert.match(forum,/preference\?\.discussion\?\.defaultSort/);
 assert.match(forum,/preference\?\.discussion\?\.showLiveUpdates/);
 assert.match(forum,/preference\?\.feed\?\.showRecommendations/);
 assert.match(forum,/startLiveReplies/);
 assert.match(forum,/stopLiveReplies/);
 assert.match(notifications,/preferences\.notifications\?\.announcements/);
 assert.match(notifications,/if\(!showAnnouncementBanners\)/);
});
test("expanded UI has mobile navigation and no promise of a full account export",()=>{
 const css=read("assets/css/settings.css");
 const module=read("assets/js/settings-advanced.js");
 const page=read("settings.html");
 assert.match(css,/\.settings-interest-grid/);
 assert.match(css,/@media\(max-width:540px\)/);
 assert.match(module,/settingsSearch/);
 assert.match(module,/not a complete/i);
 assert.match(page,/name="robots" content="noindex,nofollow"/);
});
