const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("published pages use Blipmood while old URLs and parent company remain intact",async()=>{
 const {injectSiteShell,replaceLegacyBrandText}=await import("../scripts/inject-site-shell.mjs");
 const fixture='<!doctype html><html><head><title>Timzee Tech Hub</title></head><body>'+
   '<header class="site-header"><a href="https://blipmood.netlify.app/">Timzee Tech Blog</a></header>'+
   '<footer class="footer">Timzee Tech Forum · Powered by Timzee Corp</footer></body></html>';
 const built=injectSiteShell(fixture);
 assert.doesNotMatch(built,/Timzee Tech (Hub|Blog|Forum)/);
 assert.match(built,/<title>Blipmood<\/title>/);
 assert.match(built,/Blipmood · Powered by Timzee Corp/);
 assert.match(built,/https:\/\/blipmood\.netlify\.app\//);
 assert.match(built,/apple-touch-icon/);
 assert.match(built,/cb2e26bb-2d48-471d-80fc-67d8ffc1b06b\.png/);
 assert.equal((built.match(/site-shell\.js/g)||[]).length,1);
 assert.equal(injectSiteShell(built),built,"shell injection must be idempotent");
 assert.equal(replaceLegacyBrandText("Timzee Corp"),"Timzee Corp");
 assert.equal(replaceLegacyBrandText('Timzee <span>Tech</span> Hub'),"Blipmood");
});
test("shared header and footer use the actual approved image, including mood eyes and play-button i",()=>{
 const shell=read("assets/js/site-shell.js");
 const styles=read("assets/css/blipmood-brand.css");
 assert.match(shell,/function ensureBlipmoodHeader/);
 assert.match(shell,/function createBlipmoodWordmark/);
 assert.match(shell,/BRAND_IMAGES/);
 assert.match(shell,/synchronizeBrandImages/);
 assert.match(shell,/bm-wordmark-image/);
 assert.match(styles,/\.bm-wordmark-image/);
 assert.match(shell,/Powered by Timzee Corp/);
 assert.match(shell,/Blipmood — Home/);
});
test("outgoing transactional and staff emails display Blipmood and preserve verified sender address",()=>{
 const worker=read("netlify/functions/email-worker.js");
 const staff=read("netlify/functions/_lib/staff-email-template.js");
 const reply=read("netlify/functions/admin-reply-email.js");
 assert.doesNotMatch(worker,/Timzee Tech Hub/);
 assert.match(worker,/sender:\{email:senderEmail,name:senderName\}/);
 assert.match(worker,/BREVO_SENDER_EMAIL/);
 assert.match(worker,/blipmood-wordmark-dark\.png/);
 assert.match(staff,/blipmood-wordmark-dark\.png/);
 assert.match(reply,/BREVO_REPLY_TO_EMAIL/);
 assert.match(reply,/name:"Blipmood"/);
});
