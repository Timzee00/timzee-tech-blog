const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const read = (file) => readFileSync(join(__dirname, "..", file), "utf8");

test("V7 design stays scoped to the member login page", () => {
  const html = read("login.html");
  const css = read("assets/css/blipmood-auth-v7.css");
  assert.match(html, /class="auth-v7-page"/);
  assert.match(html, /assets\/css\/blipmood-auth-v7\.css/);
  // Build downloads the checksum-pinned wordmark after source-page validation.
  // Source markup must use the canonical URL, which build-site rewrites locally.
  const brandAssets = read("scripts/brand-assets.mjs");
  assert.match(html, /src="https:\/\/d2ol7oe51mr4n9\.cloudfront\.net\/[^"]+\.png"/);
  assert.match(brandAssets, /blipmood-wordmark-dark\.png/);
  assert.doesNotMatch(html, /src="assets\/brand\/blipmood-wordmark-dark\.png"/);
  assert.match(css, /body\.auth-v7-page/);
  assert.match(css, /blipmood-auth-metallic-v7\.svg/);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /max-width:\s*540px/);
  assert.match(css, /\.auth-switcher\[data-view="signup"\]/);
});

test("Login and registration keep accessible controls and trusted auth IDs", () => {
  const html = read("login.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate HTML IDs");
  for (const id of ["loginForm","signupForm","forgotForm","resetForm","loginEmail","loginPassword","loginRemember","signupName","signupEmail","signupPassword","signupPasswordConfirm","signupTerms","googleSignIn","appleSignIn","googleSignUp","appleSignUp","forgotToggle"]) {
    assert.ok(ids.includes(id), "missing auth ID: " + id);
  }
  assert.match(html, /data-switch="signup"/);
  assert.match(html, /data-switch="login"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /id="signupTerms" required/);
  assert.match(html, /href="terms\.html"/);
  assert.match(html, /href="privacy\.html"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-password-toggle="signupPasswordConfirm"/);
});

test("Supabase sign in, callback, recovery and onboarding remain intact", () => {
  const js = read("assets/js/user-auth.js");
  assert.match(js, /getAuthCallbackError/);
  assert.match(js, /getSafeNextUrl/);
  assert.match(js, /handleOAuthSignIn/);
  assert.match(js, /nextAfterMemberSetup/);
  assert.match(js, /fetchProfileStatus/);
  assert.match(js, /resetPassword\(email, redirectTo\)/);
  assert.match(js, /loginRemember/);
  assert.match(js, /blipmood:remember-email/);
  assert.match(js, /signupPasswordConfirm/);
  assert.match(js, /signupTerms/);
  assert.match(js, /signUpWithProvider/);
  assert.match(js, /signUp\(email, password, name\)/);
  assert.doesNotMatch(js, /const password = document\.getElementById\("loginPassword"\)\.value\.trim\(\)/);
});

test("Reference-inspired metallic SVG remains an original local vector", () => {
  const svg = read("assets/brand/blipmood-auth-metallic-v7.svg");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<linearGradient/);
  assert.match(svg, /<path/);
  assert.match(svg, /<\/svg>$/);
  assert.doesNotMatch(svg, /<script|<foreignObject|<iframe|onload=/i);
});
test("Blipmood member auth uses its real teal/blue palette and never the reference gold CTA", () => {
  const css = read("assets/css/blipmood-auth-v7.css");
  const artwork = read("assets/brand/blipmood-auth-metallic-v7.svg");
  const brandAssets = read("scripts/brand-assets.mjs");
  assert.match(css, /--v7-accent:\s*#69d3c1/i);
  assert.match(css, /--v7-accent-deep:\s*#2368a2/i);
  assert.match(css, /#89bce9|#87c6eb|#8cc9eb/i);
  assert.match(artwork, /#69d3c1|#70d2cb/i);
  assert.match(brandAssets, /blipmood-wordmark-dark\.png/);
  assert.doesNotMatch(css, /--v7-gold|#ffe03a|#fff54e|#ffda21|#f4bb15/i);
  assert.doesNotMatch(artwork, /url\(#gold\)|#ffc976|#fbd490/i);
});

test("polished auth provides narrow-screen forms, inline errors and accessible progress", () => {
  const css = read("assets/css/blipmood-auth-v7.css");
  const html = read("login.html");
  const js = read("assets/js/user-auth.js");
  assert.match(css, /@media\s*\(max-width:480px\)/);
  assert.match(css, /\.auth-password-pair\s*\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /id="signupPasswordBars"/);
  assert.match(html, /id="signupPasswordStrength"/);
  assert.match(html, /id="signupPasswordMatch"/);
  assert.match(js, /updatePasswordGuidance/);
  assert.match(js, /validateForm\(loginForm\)/);
  assert.match(js, /setFormBusy\(loginForm, true\)/);
  assert.match(js, /setFormBusy\(signupForm, true\)/);
  assert.match(js, /submit\.setAttribute\("aria-busy", String\(busy\)\)/);
  assert.match(js, /password !== confirm/);
});

test("signup shows verification instructions only after success, and enforces configured password guidance", () => {
  const html = read("login.html");
  const js = read("assets/js/user-auth.js");
  assert.doesNotMatch(html, /class="auth-v7-note">Check your inbox or spam folder/);
  assert.ok(js.includes('lower.includes("error sending confirmation email")'));
  assert.ok(js.includes('if (result.error) {'));
  assert.ok(js.includes('meetsSignupPasswordPolicy(password)'));
  assert.ok(js.includes('Password meets the required format'));
  assert.ok(js.includes('Account created. Confirm your email'));
  assert.ok(js.includes('/[^a-zA-Z0-9\\s]/'));
});

test("signup confirmation is Blipmood branded and reaches existing three-step setup", () => {
  const template=read("docs/templates/blipmood-supabase-confirm-signup.html");
  const page=read("confirm-email.html");
  const confirm=read("assets/js/confirm-email.mjs");
  const onboarding=read("assets/js/member-onboarding.mjs");
  assert.match(template, /Confirm your Blipmood account/);
  assert.doesNotMatch(template, /Timzee Tech Hub/);
  assert.match(template, /confirm-email\.html\?token_hash=\{\{ \.TokenHash \}\}/);
  assert.doesNotMatch(template, /\.ConfirmationURL/);
  assert.match(page, /id="confirmEmailButton"/);
  assert.match(page, /noindex,nofollow/);
  assert.match(page, /name="referrer" content="no-referrer"/);
  assert.match(confirm, /addEventListener\("click",async/);
  assert.match(confirm, /supabase\.auth\.verifyOtp\(\{token_hash:tokenHash,type:"email"\}\)/);
  assert.match(confirm, /history\.replaceState/);
  assert.match(confirm, /window\.location\.replace\("\/welcome\.html"\)/);
  assert.doesNotMatch(confirm, /window\.location\.replace\(.*index\.html/);
  assert.match(onboarding, /if\(o\.data\?\.completed_at\)\{location\.replace\(nextTarget\(\)\);return;\}/);
});

test("only a deliberate click can consume a signup confirmation token",async()=>{
  const vm=require("node:vm");
  const source=read("assets/js/confirm-email.mjs")
    .replace(/^import \{supabase\} from "\.\/supabase\.js";\s*/,"");
  const handlers={};
  const status={textContent:"",dataset:{}};
  const button={disabled:true,textContent:"",addEventListener:(name,fn)=>{handlers[name]=fn;}};
  const pages={confirmEmailButton:button,confirmEmailStatus:status};
  let verifications=0,dest="",removed="";
  const client={auth:{
    verifyOtp:async ({token_hash,type})=>{
      verifications++;
      assert.equal(token_hash,"a".repeat(64));
      assert.equal(type,"email");
      return {data:{user:{id:"account-one"},session:{access_token:"temporary"}},error:null};
    },
    getUser:async()=>({data:{user:{id:"account-one"}},error:null})
  }};
  const context={
    supabase:client,
    document:{getElementById:(id)=>pages[id],title:"Confirm your email"},
    window:{location:{search:"?token_hash="+("a".repeat(64))+"&type=email",href:"https://blipmood.netlify.app/confirm-email.html?token_hash="+("a".repeat(64))+"&type=email",replace:(url)=>{dest=url;}}},
    history:{replaceState:(_a,_b,url)=>{removed=url;}},
    URL,URLSearchParams,console
  };
  vm.runInNewContext(source,context,{timeout:1200});
  assert.equal(verifications,0,"opening an email link must not consume the token");
  assert.equal(button.disabled,false);
  await handlers.click();
  assert.equal(verifications,1);
  assert.equal(dest,"/welcome.html");
  assert.equal(removed,"/confirm-email.html");
});
