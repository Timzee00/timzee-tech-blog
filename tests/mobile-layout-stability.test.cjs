const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const read=path=>readFileSync(resolve(__dirname,"..",path),"utf8");

test("cookie consent uses bounded mobile and desktop overlays without moving the feed",()=>{
  const ui=read("assets/js/privacy-consent.js");
  const css=read("assets/css/design-system.css");
  assert.match(ui,/document\.body\.append\(banner\)/);
  assert.doesNotMatch(ui,/header\.insertAdjacentElement\("afterend", banner\)/);
  assert.match(css,/#timzee-consent-banner\s*\{\s*position:\s*fixed/);
  assert.doesNotMatch(css,/#timzee-consent-banner\s*\{\s*position:\s*relative\s*!important/);
  assert.match(css,/max-height:\s*calc\(100dvh\s*-\s*104px/);
  assert.match(css,/overscroll-behavior:\s*contain/);
});

test("async site announcements never prepend to body or push the header down",()=>{
  const js=read("assets/js/notification-popup.js");
  assert.match(js,/position:\s*fixed/);
  assert.match(js,/document\.body\.append\(banner\)/);
  assert.doesNotMatch(js,/document\.body\.prepend\(banner\)/);
  assert.match(js,/site-announcement-banner/);
  assert.match(js,/max-height:\s*min\(230px, 33dvh\)/);
});

test("mobile navigation is hidden until moved into the drawer, retaining touchable actions",()=>{
  const css=read("assets/css/navbar.css");
  assert.match(css,/\.site-header \.wrap > \.nav-pill/);
  assert.match(css,/\.site-header \.wrap > \.header-actions\s*\{\s*display:\s*none/);
  assert.match(css,/body\.nav-open \.site-menu/);
  const buttons=read("assets/css/home.css");
  assert.match(buttons,/\.post-icon-btn\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px/);
  assert.match(buttons,/\.post-icon-row\s*\{[\s\S]*?flex-wrap:\s*wrap/);
});

test("marketing media stays responsive without forcing a false intrinsic ratio",()=>{
  const app=read("assets/js/app.js");
  const html=read("index.html");
  const home=read("assets/css/blipmood-home.css");
  assert.match(app,/loading="lazy" decoding="async" fetchpriority="low"/);
  assert.doesNotMatch(app,/fetchpriority="low" width="640" height="360"/);
  assert.match(html,/data-bm-logo="emblem"[^>]*width="380" height="361" fetchpriority="high"/);
  assert.match(home,/aspect-ratio:\s*600\s*\/\s*570/);
});
