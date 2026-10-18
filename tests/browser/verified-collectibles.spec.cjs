const {test,expect}=require("@playwright/test");
const {mockSite}=require("./helpers/fixtures.cjs");

test("original verification badge assets are bundled and readable",async({request})=>{
  for(const tier of ["silver","gold","platinum","business"]){
    const response=await request.get("/assets/img/timzee-verified-"+tier+".svg");
    expect(response.status(),tier).toBe(200);
    expect(await response.text()).toContain("<svg");
  }
});

test("all collectible designs fit narrow phones with visible profile accents",async({page})=>{
  await mockSite(page,{role:"user"});
  await page.goto("/profile.html");
  await page.emulateMedia({reducedMotion:"reduce"});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:780});
    const details=await page.evaluate(async()=>{
      const {FRAME_OPTIONS,verifiedAvatar,verifiedName}=await import("/assets/js/verified-identity.mjs");
      document.getElementById("collectibleVisualTest")?.remove();
      const host=document.createElement("section");
      host.id="collectibleVisualTest";
      host.style.cssText="max-width:100%;min-width:0;display:block";
      const p={is_verified:true,verification_tier:"platinum",frame_style:"signature"};
      host.innerHTML='<h2>Frame collection</h2><div class="tz-frame-gallery">'+FRAME_OPTIONS.map(x=>
        '<div class="tz-frame-choice" aria-label="'+x.title+'">'+
        verifiedAvatar("/assets/img/avatar-placeholder.svg",{...p,frame_style:x.id},{size:"lg"})+
        '<strong>'+x.title+'</strong></div>').join("")+'</div>';
      document.querySelector("main")?.append(host);
      const full= document.querySelector(".profile-hero");
      if(full){
        full.classList.add("tz-frame","tz-frame--platinum");
        full.dataset.verificationLevel="platinum";
        full.dataset.frameStyle="library";
      }
      const viewport=document.documentElement.clientWidth;
      const cards=[...host.querySelectorAll(".tz-frame-choice")].map(card=>({
        left:card.getBoundingClientRect().left,
        right:card.getBoundingClientRect().right
      }));
      return {
        viewport,
        scroll:document.documentElement.scrollWidth,
        count:cards.length,
        outOfView:cards.filter(x=>x.left<-2||x.right>viewport+2).length,
        border:full?getComputedStyle(full,"::before").borderTopStyle:"missing"
      };
    });
    expect(details.count).toBe(6);
    expect(details.scroll).toBeLessThanOrEqual(details.viewport+2);
    expect(details.outOfView).toBe(0);
    expect(details.border).not.toBe("none");
  }
});

test("decorative motion can be disabled without losing verification badges",async({page})=>{
  await mockSite(page);
  await page.goto("/offline.html");
  const rendered=await page.evaluate(async()=>{
    const {verifiedAvatar}=await import("/assets/js/verified-identity.mjs");
    const profile={is_verified:true,verification_tier:"gold",frame_style:"comet"};
    const host=document.createElement("div");
    host.innerHTML=verifiedAvatar("/assets/img/avatar-placeholder.svg",profile,{size:"md"});
    document.body.append(host);
    document.documentElement.dataset.reduceMotion="true";
    const avatar=host.firstElementChild;
    const reduced=getComputedStyle(avatar,"::after").animationName;
    return {name:avatar.className,reduced};
  });
  expect(rendered.name).toContain("tz-frame--gold");
  expect(rendered.name).toContain("tz-frame--comet");
  expect(rendered.reduced).toBe("none");
});
