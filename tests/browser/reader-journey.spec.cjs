const {test,expect}=require("@playwright/test");
const {mockSite,USER_ID,POST_ID,records}=require("./helpers/fixtures.cjs");

test("returning member sees private reading, creator updates and relevant interests without overflow",async({page})=>{
  await mockSite(page,{role:"user",populated:true});
  await page.route("https://**.supabase.co/rest/v1/article_reading_progress*",route=>{
    const single=(route.request().headers().accept||"").includes("object+json");
    const data=single?{progress_percent:46,completed_at:null}:[{
      post_id:POST_ID,progress_percent:46,last_read_at:"2026-10-19T08:00:00Z",
      posts:{id:POST_ID,title:records.posts[0].title,author_name:"Alex Morgan",
        cover:null,status:"published",publish_at:null}
    }];
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data),
      headers:{"access-control-allow-origin":"*"}});
  });
  await page.route("https://**.supabase.co/rest/v1/rpc/reader_following_articles",route=>
    route.fulfill({status:200,contentType:"application/json",body:JSON.stringify([{
      post_id:POST_ID,title:records.posts[0].title,author_name:"Alex Morgan",
      created_at:"2026-10-19T08:00:00Z"
    }]),headers:{"access-control-allow-origin":"*"}}));
  await page.route("https://**.supabase.co/rest/v1/community_user_interests*",route=>
    route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify([{topic:"Programming"}]),headers:{"access-control-allow-origin":"*"}}));
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#readerJourneySection")).toBeVisible({timeout:12000});
  await expect(page.locator("#readerContinue .tz-reader-card")).toHaveCount(1);
  await expect(page.locator("#readerFollowing .tz-reader-card")).toHaveCount(1);
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:800});
    const sizes=await page.evaluate(()=>{
      const viewport=document.documentElement.clientWidth;
      const cards=[...document.querySelectorAll("#readerJourneySection .tz-reader-card")];
      return {viewport,scroll:document.documentElement.scrollWidth,
        overflow:cards.filter(card=>{
          const r=card.getBoundingClientRect();
          return r.left< -2||r.right>viewport+2;
        }).length};
    });
    expect(sizes.overflow).toBe(0);
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.viewport+2);
  }
  const resume=page.locator("#readerContinue .tz-reader-card").first();
  await expect(resume).toHaveAttribute("href",new RegExp("resume=1"));
});

test("private reading positions are visible only in signed-in owner's saved tab",async({page})=>{
  await mockSite(page,{role:"user",populated:true});
  await page.route("https://**.supabase.co/rest/v1/article_reading_progress*",route=>{
    const data=[{post_id:POST_ID,progress_percent:25,
      posts:{id:POST_ID,title:"A saved article",author_name:"Alex Morgan",status:"published"}}];
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data),
      headers:{"access-control-allow-origin":"*"}});
  });
  await page.goto("/profile.html?id="+USER_ID+"&tab=bookmarks",{waitUntil:"domcontentloaded"});
  await expect(page.locator("#profileReadingList .tz-reader-library-item")).toHaveCount(1,{timeout:12000});
  await expect(page.locator("#profileReadingList")).toContainText("A saved article");
  await expect(page.locator("#profileReadingStatus")).toContainText("Only you");
});
