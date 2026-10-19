const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const USER="00000000-0000-4000-8000-000000000011";
const POST="00000000-0000-4000-8000-000000000012";
function moduleWithFakeDatabase({rows=[],following=[],privacy=true,dbError=null}={}){
 const calls=[];
 const mock={
  from(table){
   const call={table,filters:[]};calls.push(call);
   const chain={
    select(fields){call.fields=fields;return chain;},
    eq(field,value){call.filters.push([field,value]);return chain;},
    is(field,value){call.filters.push([field,value]);return chain;},
    order(field,options){call.sort=[field,options.ascending];return chain;},
    limit(value){call.limit=value;return Promise.resolve({data:rows,error:dbError});},
    delete(){call.deleted=true;return chain;},
    then(resolve,reject){return Promise.resolve({error:dbError}).then(resolve,reject);}
   };
   return chain;
  },
  rpc(name,args){calls.push({rpc:name,args});return Promise.resolve({
   data:name==="reader_following_articles"?following:true,error:dbError
  });}
 };
 let source=read("assets/js/reader-journey.mjs")
   .replace(/^import[^\n]*\n/gm,"")
   .replace(/^export\s+/gm,"");
 const context={supabase:mock,loadUserPreferences:async()=>({privacy:{rememberReading:privacy}}),
   Date,Number,Math,String,Set,Promise,console,URLSearchParams};
 vm.runInNewContext(source+"\nthis.reader={safeArticleHref,percentBound,getContinueReading,getFollowingArticles,recordReading,forgetReadingEntry,getReadingPreference};",context,{timeout:1000});
 return{reader:context.reader,calls};
}
test("reading progress and creator following are privately scoped and opt-out enforced",()=>{
 const sql=read("supabase/migrations/20261019095000_reader_journey_private_progress_following.sql");
 assert.match(sql,/PRIMARY KEY \(user_id,post_id\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/GRANT SELECT,DELETE ON public\.article_reading_progress TO authenticated/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|UPDATE|INSERT).*article_reading_progress TO authenticated/);
 assert.match(sql,/user_id=\(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/p\.status='published'/);
 assert.match(sql,/rememberReading/);
 assert.match(sql,/SECURITY DEFINER/);
 assert.match(sql,/SECURITY INVOKER/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.record_article_reading\(uuid,integer\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.reader_following_articles\(integer\)/);
});
test("continuing feed is bounded and ignores completed or inaccessible articles",async()=>{
 const {reader,calls}=moduleWithFakeDatabase({rows:[
  {post_id:POST,progress_percent:43,last_read_at:"2026-10-19T00:00:00Z",
   posts:{id:POST,title:"AI tools",author_name:"Writer",cover:null,status:"published",publish_at:null}},
  {post_id:"00000000-0000-4000-8000-000000000013",progress_percent:97,
   posts:{id:"00000000-0000-4000-8000-000000000013",title:"Done",publish_at:null}},
  {post_id:"00000000-0000-4000-8000-000000000014",progress_percent:21,
   posts:{id:"00000000-0000-4000-8000-000000000014",title:"Future",publish_at:"2099-01-01T00:00:00"}}
 ]});
 assert.equal((await reader.getContinueReading("not-a-user")).length,0);
 const result=await reader.getContinueReading(USER,800);
 assert.equal(result.length,1);
 assert.equal(result[0].id,POST);
 assert.equal(result[0].percent,43);
 assert.equal(calls[0].limit,8);
 assert.ok(calls[0].filters.some(x=>x[0]==="user_id"&&x[1]===USER));
 assert.ok(calls[0].filters.some(x=>x[0]==="posts.status"&&x[1]==="published"));
});
test("following articles and progress writes are bounded, validated and server-owned",async()=>{
 const {reader,calls}=moduleWithFakeDatabase({following:[
  {post_id:POST,title:"New guide",author_name:"Creator"},
  {post_id:"javascript:alert(1)",title:"Not a post"}
 ]});
 assert.equal(reader.safeArticleHref("javascript:alert(1)"),null);
 assert.equal(reader.percentBound(200),100);
 assert.equal(reader.percentBound(-30),0);
 const rows=await reader.getFollowingArticles(200);
 assert.equal(rows.length,1);
 assert.equal(calls[0].args.p_limit,8);
 assert.equal(await reader.recordReading("bad",40),false);
 assert.equal(await reader.recordReading(POST,0),false);
 assert.equal(await reader.recordReading(POST,101),true);
 assert.equal(calls.at(-1).args.p_percent,100);
});
test("history deletion scopes to account and optional post; preferences suppress article recording",async()=>{
 const {reader,calls}=moduleWithFakeDatabase({privacy:false});
 assert.equal(await reader.getReadingPreference({id:USER}),false);
 await assert.rejects(()=>reader.forgetReadingEntry("not-a-user"),/Sign in/);
 await reader.forgetReadingEntry(USER,POST);
 const deletion=calls.find(x=>x.deleted);
 assert.ok(deletion);
 assert.ok(deletion.filters.some(x=>x[0]==="user_id"&&x[1]===USER));
 assert.ok(deletion.filters.some(x=>x[0]==="post_id"&&x[1]===POST));
});
test("retention surfaces are wired to existing homepage, posts, bookmarks and settings",()=>{
 const homepage=read("index.html"),post=read("assets/js/post.js"),
       app=read("assets/js/app.js"),profile=read("assets/js/profile.js"),
       profilePage=read("profile.html"),settings=read("assets/js/settings-page.js"),
       prefs=read("assets/js/user-preferences.js"),css=read("assets/css/reader-journey.css"),
       home=read("assets/js/reader-home.mjs"),library=read("assets/js/reader-library.mjs"),
       privacy=read("privacy.html"),styles=read("assets/css/styles.css");
 for(const id of ["readerJourneySection","readerContinue","readerFollowing","readerBookmarksLink"])
   assert.match(homepage,new RegExp('id="'+id+'"'));
 assert.match(post,/mountArticleJourney\(\{post,user:state\.user\}\)/);
 assert.match(app,/mountReaderHome\(state\.user\)/);
 assert.match(profile,/mountReadingLibrary\(state\.user\)/);
 assert.match(profilePage,/id="profileReadingList"/);
 assert.match(settings,/data-path="privacy\.rememberReading"/);
 assert.match(settings,/forgetReadingEntry\(state\.user\.id\)/);
 assert.match(prefs,/rememberReading: true/);
 assert.match(css,/minmax\(min\(100%,340px\),1fr\)/);
 assert.match(home,/textContent=/);
 assert.match(library,/document\.createElement/);
 assert.match(privacy,/Private article reading history/);
 assert.match(styles,/reader-journey\.css/);
});
