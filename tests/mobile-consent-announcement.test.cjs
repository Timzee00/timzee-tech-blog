const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const read=path=>readFileSync(resolve(__dirname,'..',path),'utf8');
test('cookie notice has separated accessible links and retains opt-in/opt-out controls',()=>{
 const src=read('assets/js/privacy-consent.js');
 assert.match(src,/class="timzee-consent-links"/);
 assert.match(src,/href="\/privacy\.html"/);
 assert.match(src,/href="\/cookies\.html"/);
 assert.match(src,/data-consent="manage"/);
 assert.match(src,/data-consent="decline"/);
 assert.match(src,/data-consent="accept"/);
 assert.match(src,/timzee-consent-links\{display:flex;flex-wrap:wrap/);
 assert.match(src,/if \(force \|\| !readConsent\(\)\)/);
});
test('mobile announcement collapses text without discarding full content',()=>{
 const src=read('assets/js/notification-popup.js');
 assert.match(src,/\.site-announcement-body\{display:-webkit-box/);
 assert.match(src,/-webkit-line-clamp:2/);
 assert.match(src,/max-height:min\(136px,24dvh\)/);
 assert.match(src,/viewLink\.href = "announcements.html"/);
 assert.match(src,/body\.textContent = getAnnouncementBody\(announcement\)/);
 assert.match(src,/dismiss\.addEventListener/);
});
test('consent and announcement scripts remain parseable JavaScript',()=>{
 for(const file of ['assets/js/privacy-consent.js','assets/js/notification-popup.js']){
  const source=read(file).replace(/^import[\s\S]*?;\s*$/gm,'').replace(/^export\s+/gm,'');
  assert.doesNotThrow(()=>new Function(source));
 }
});
