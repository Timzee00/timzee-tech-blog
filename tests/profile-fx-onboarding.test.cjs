const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const source=read("assets/js/profile-fx.mjs").replace(/^export\s+/gm,"");
function engineContext(extra={}){
 const jobs=[];
 const mock={
  window:{devicePixelRatio:1,innerWidth:390,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
    addEventListener(){},removeEventListener(){}},
  document:{hidden:false,documentElement:{dataset:{}},addEventListener(){},removeEventListener(){}},
  navigator:{hardwareConcurrency:2},
  requestAnimationFrame(cb){jobs.push(cb);return jobs.length},
  cancelAnimationFrame(){}, Math,Number,Set,Object,Map,
  ...extra
 };
 vm.runInNewContext(source+"\nthis.fx={FX_EFFECTS,DEFAULT_FX,normalizeFx,safeFxRadius,createProfileFxEngine};",mock);
 return {fx:mock.fx,jobs,mock};
}
test("all visual FX options are gender-neutral and validated",()=>{
 const {fx}=engineContext();
 assert.equal(fx.FX_EFFECTS.length,15);
 for(const preset of ["stardust","storm","aurora","neon","sakura","diamond"])
  assert.ok(fx.FX_EFFECTS.some(x=>x.id===preset));
 assert.equal(fx.normalizeFx({cover_effect:"<script>",avatar_effect:"missing",intensity:999}).cover_effect,"none");
 assert.equal(fx.normalizeFx({intensity:-200}).intensity,0);
 assert.equal(fx.normalizeFx({intensity:NaN}).intensity,45);
 assert.equal(fx.normalizeFx({enabled:false}).enabled,false);
 const sourceCode=read("assets/js/profile-fx.mjs");
 assert.doesNotMatch(sourceCode,/\bmale\b|\bfemale\b|\bgirls\b|\bboys\b/i);
});
test("stardust and all canvas circle radii are finite and nonnegative",()=>{
 const {fx}=engineContext();
 for(const value of [-0.0355833,NaN,-Infinity,Infinity,-10,0])
  assert.equal(fx.safeFxRadius(value),0);
 assert.equal(fx.safeFxRadius(4.75),4.75);
 assert.equal(fx.safeFxRadius(10000),120);
 assert.match(source,/if\(p.life<=0\)return false/);
 assert.match(source,/safeFxRadius\(p.size\*proportion\)/);
});
test("particle engine survives 220 simulated mobile frames, caps particles and cleans up",()=>{
 const {fx,jobs}=engineContext();
 const throws=[];
 const context={
  setTransform(){},clearRect(){},fillRect(){},beginPath(){},
  arc(x,y,r){if(r<0||!Number.isFinite(r))throws.push(r);},fill(){},stroke(){},
  moveTo(){},lineTo(){},quadraticCurveTo(){},bezierCurveTo(){},ellipse(){},
  save(){},restore(){},translate(){},rotate(){},closePath(){},
  createRadialGradient(){return {addColorStop(){}};}
 };
 const canvas={width:0,height:0,getContext:()=>context};
 const host={dataset:{},getBoundingClientRect(){return {width:320,height:220}}};
 const avatar={dataset:{},style:{setProperty(){},removeProperty(){}}};
 const runner=fx.createProfileFxEngine({host,canvas,avatar,maxParticles:30});
 for(const cover_effect of ["stardust","storm","frost","void","inferno","aurora","sakura","glitch","diamond"]){
  runner.apply({cover_effect,avatar_effect:"halo",intensity:80,enabled:true});
  let clock=0;
  for(let i=0;i<220;i++){
   const queue=jobs.splice(0);
   clock+=43;
   for(const tick of queue)tick(clock);
   assert.ok(runner.particleCount<=30,"Particle cap exceeded");
  }
 }
 runner.destroy();runner.destroy();
 assert.deepEqual(throws,[]);
 assert.equal(host.dataset.fxCover,"diamond");
});
test("cover photo stays a real image with a pointer-transparent FX overlay",()=>{
 const html=read("profile.html"),style=read("assets/css/profile-fx.css"),profile=read("assets/js/profile.js");
 assert.match(html,/id="profileCoverImg"/);
 assert.match(html,/id="profileFxCanvas"/);
 assert.match(html,/id="fxStudioCover"/);
 assert.match(style,/pointer-events:none/);
 assert.match(style,/mix-blend-mode:screen/);
 assert.match(profile,/void setupProfileFx\(\)/);
 assert.match(profile,/member_profile_effects/);
 assert.match(profile,/\.upsert\(\{user_id:state.user.id/);
 assert.match(style,/@media\(prefers-reduced-motion:reduce\)/);
});
test("onboarding gender restricts starter illustrations and database validates new submissions",()=>{
 const setup=read("assets/js/member-onboarding.mjs");
 const html=read("welcome.html");
 const sql=read("supabase/migrations/20261029162345_profile_fx_and_gender_consistent_starter_20261029.sql");
 assert.match(setup,/allowedStarterAvatar\(gender,avatar\)/);
 assert.match(setup,/input.disabled=!permitted/);
 assert.match(setup,/if\(!permitted\)input.checked=false/);
 assert.match(setup,/avatarSelection\(\)/);
 assert.match(setup,/if\(!allowedStarterAvatar\(\$\("setupGender"\)\.value,avatar\)\)/);
 assert.match(html,/starterAvatarHelp/);
 assert.match(html,/Choose gender first/);
 assert.match(sql,/member_onboarding_gender_avatar_consistent/);
 assert.match(sql,/not valid/);
 assert.match(sql,/enable row level security/);
 const validated=read("supabase/migrations/20261029163127_validate_gender_starter_avatar_pair.sql");
 assert.match(validated,/member_onboarding_gender_avatar_consistent/);
 assert.match(validated,/avatar_style is not null and avatar_style=gender/);
});
test("member visual preferences have owner-only mutations and public safe display",()=>{
 const sql=read("supabase/migrations/20261029162345_profile_fx_and_gender_consistent_starter_20261029.sql");
 assert.match(sql,/member_profile_effects/);
 assert.match(sql,/for insert to authenticated with check\(user_id=\(select auth.uid\(\)\)\)/);
 assert.match(sql,/for update to authenticated using\(user_id=\(select auth.uid\(\)\)/);
 assert.match(sql,/for delete to authenticated using\(user_id=\(select auth.uid\(\)\)/);
 assert.match(sql,/intensity between 0 and 100/);
 assert.match(sql,/cover_effect in/);
 assert.match(sql,/avatar_effect in/);
 assert.doesNotMatch(sql,/alter table public.profiles add column.*verification_tier/i);
});

test("social-first profile keeps the identity header visible across all content tabs",()=>{
 const html=read("profile.html"),script=read("assets/js/profile.js"),css=read("assets/css/blipmood-profile-redesign.css");
 const hero=html.indexOf('class="container profile-masthead"');
 const tabs=html.indexOf('id="profileTabs"');
 const overview=html.indexOf('data-profile-section="overview"');
 assert.ok(hero>0&&hero<tabs&&tabs<overview,"Cover, avatar and identity stay above the tab sections");
 for(const tab of ["overview","media","videos","activity","bookmarks","notifications","settings"])
  assert.match(html,new RegExp('data-tab="'+tab+'"'));
 for(const id of ["profileCoverImg","profileAvatar","profileFxCanvas","profileFrameName","profileBadges",
  "profileActions","profileSpotlightStats","profileStats","profilePostFeed","profileMediaGallery",
  "profileVideoGallery","profileEditor","profileFxStudio","profileMorePosts","profileMoreMedia"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/data-profile-image="avatar"/);
 assert.match(script,/renderProfileHighlights\(\)/);
 assert.match(script,/void loadProfilePosts\(\)/);
 assert.ok(script.includes('.from("community_threads")'));
 assert.ok(script.includes('.eq("status","published")'));
 assert.ok(script.includes("isSafeUrl(asset.media_url)"));
 assert.ok(script.includes("profilePostUrl(post.id)"));
 assert.ok(script.includes(".range(offset,offset+PROFILE_POST_PAGE)"));
 assert.ok(css.includes("@media(max-width:670px)"));
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test("cinematic profile keeps real photo, verified identity and editable settings",()=>{
 const html=read("profile.html"),css=read("assets/css/blipmood-neon-experience.css"),
  logic=read("assets/js/profile.js");
 assert.match(html,/<body class="blipmood-profile">/);
 assert.match(html,/href="assets\/css\/blipmood-neon-experience\.css"/);
 assert.match(html,/class="bm-profile-identity-kicker"/);
 assert.match(html,/id="profileTabs" role="group" aria-label="Profile sections"/);
 assert.equal((html.match(/<h1\b/g)||[]).length,1);
 for(const id of ["profileCoverImg","profileAvatar","profileFxCanvas","profileFrameName",
 "profileName","profileHandle","profileIdentityExtras","profileBadges","profileActions",
 "profileSpotlightStats","profileStats","profileTabs","profilePostFeed","profileMorePosts",
 "profileMediaGallery","profileVideoGallery","profileVerification","profileFriends",
 "profileEditor","profileForm","editCoverFile","editAvatarFile","profileFxStudio",
 "fxStudioCanvas","fxSave","fxRestore"])
  assert.ok(html.includes('id="'+id+'"'),"Profile control lost: "+id);
 for(const tab of ["overview","media","videos","activity","bookmarks","notifications","settings"])
  assert.ok(html.includes('data-tab="'+tab+'"'),"Tab missing: "+tab);
 assert.match(css,/body\.blipmood-profile\{/);
 assert.match(css,/\.blipmood-profile \.profile-page \.profile-cover-open\{z-index:1\}/);
 assert.match(css,/\.blipmood-profile \.profile-page \.profile-actions \.btn/);
 assert.match(css,/\.blipmood-profile \.profile-page \.profile-tabs button.active/);
 assert.match(css,/\.blipmood-profile \.profile-page \.bm-profile-identity-kicker/);
 assert.match(css,/pointer-events:none/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(logic,/verifiedName\(displayName,state\.profile\)/);
 assert.match(logic,/void loadProfilePosts\(\)/);
 assert.match(logic,/function renderProfileActions\(\)/);
});
