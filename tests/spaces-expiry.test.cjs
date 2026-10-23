const test=require("node:test");
const assert=require("node:assert/strict");
const {expireSpaces,roomIsExpired,liveKitHost,MAX_EXPIRED_PER_RUN}=
 require("../netlify/functions/_lib/spaces-expiry.cjs");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const NOW=Date.parse("2026-10-23T16:00:00Z");
const CONFIG={LIVEKIT_URL:"wss://demo.livekit.cloud/",LIVEKIT_API_KEY:"id",LIVEKIT_API_SECRET:"secret"};
const expired={id:id(1),starts_at:"2026-10-23T15:00:00Z",max_duration_minutes:30};
function fakeDb(rows,closed){
 return {from(table){
  assert.equal(table,"spaces_rooms");
  return {
   select:()=>({eq:()=>({order:()=>({limit:async()=>({data:rows,error:null})})})}),
   update:data=>({eq:(field,value)=>({eq:async()=>{
    closed.push({field,value,data});return {error:null};
   }})})
  };
 }};
}
test("expire only valid rooms with elapsed duration",()=>{
 assert.equal(roomIsExpired(expired,NOW),true);
 assert.equal(roomIsExpired({...expired,starts_at:"2026-10-23T15:45:00Z"},NOW),false);
 assert.equal(roomIsExpired({...expired,id:"wrong"},NOW),false);
 assert.equal(MAX_EXPIRED_PER_RUN,8);
 assert.equal(liveKitHost(CONFIG),"https://demo.livekit.cloud");
 assert.equal(liveKitHost({...CONFIG,LIVEKIT_URL:"http://wrong.example"}),null);
});
test("no expired rooms require no LiveKit credentials",async()=>{
 const closed=[];
 const result=await expireSpaces({
  db:fakeDb([{...expired,starts_at:"2026-10-23T15:55:00Z"}],closed),
  env:{},now:NOW,fetcher:async()=>{throw Error("unexpected")}
 });
 assert.equal(result.skipped,true);
 assert.equal(closed.length,0);
});
test("confirmed provider end closes the database session",async()=>{
 const closed=[],requests=[];
 const result=await expireSpaces({db:fakeDb([expired],closed),env:CONFIG,now:NOW,
  fetcher:async(url,options)=>{requests.push({url,options});return{ok:true,status:200}}});
 assert.equal(result.expired,1);
 assert.equal(closed.length,1);
 assert.equal(closed[0].data.status,"ended");
 assert.match(requests[0].url,/DeleteRoom$/);
 assert.equal(JSON.parse(requests[0].options.body).room,"space_"+id(1));
 assert.match(requests[0].options.headers.Authorization,/^Bearer /);
});
test("missing credentials and provider failures never falsely close the room",async()=>{
 const closed=[];
 await assert.rejects(expireSpaces({db:fakeDb([expired],closed),env:{},now:NOW}),
  /credentials are missing/);
 await assert.rejects(expireSpaces({db:fakeDb([expired],closed),env:CONFIG,now:NOW,
  fetcher:async()=>({ok:false,status:503})}),/incomplete/);
 assert.equal(closed.length,0);
});
test("cleanup is bounded and accepts provider's already-gone response",async()=>{
 const closed=[],requests=[];
 const rows=Array.from({length:12},(_,i)=>({...expired,id:id(i+1)}));
 const result=await expireSpaces({db:fakeDb(rows,closed),env:CONFIG,now:NOW,
  fetcher:async(url)=>{requests.push(url);return{ok:false,status:404}}});
 assert.equal(result.expired,8);
 assert.equal(closed.length,8);
 assert.equal(requests.length,8);
});
