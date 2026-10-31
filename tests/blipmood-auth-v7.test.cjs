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
  assert.match(html, /assets\/brand\/blipmood-mark\.svg/);
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
  assert.doesNotMatch(svg, /<script|<foreignObject|https?:\/\//i);
});