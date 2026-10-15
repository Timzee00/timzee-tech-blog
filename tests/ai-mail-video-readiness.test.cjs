const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
test("auth SMTP runbook separates SMTP relay from Netlify AI secrets",()=>{
  const doc=readFileSync(join(__dirname,"../docs/BREVO_SUPABASE_SETUP.md"),"utf8");
  assert.match(doc,/smtp-relay\.brevo\.com/);
  assert.match(doc,/SMTP key/);
  assert.match(doc,/Supabase Dashboard/);
});
test("llm proxy diagnostic is authenticated and does not include secret values",()=>{
  const code=readFileSync(join(__dirname,"../netlify/functions/llm-proxy.js"),"utf8");
  assert.ok(code.indexOf("const { data: authData") < code.indexOf('event.httpMethod === "GET"'));
  assert.match(code,/configured:\s*\{/);
  assert.match(code,/Boolean\(process\.env\.GROQ_API_KEY\?\.trim\(\)\)/);
});
test("video feed mode pages and creator gallery are present",()=>{
  const reel=readFileSync(join(__dirname,"../video.html"),"utf8");
  const grid=readFileSync(join(__dirname,"../videos.html"),"utf8");
  const profile=readFileSync(join(__dirname,"../profile.html"),"utf8");
  assert.match(reel,/data-reel-mode="following"/);
  assert.match(grid,/data-video-mode="for-you"/);
  assert.match(profile,/id="profileVideoGallery"/);
});
