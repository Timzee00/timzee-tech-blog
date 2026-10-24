const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.resolve(__dirname,"../assets/js/data.js"),"utf8")
  .replace(/^import .*;\s*$/gm,"")
  .replace(/^export\s+/gm,"");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");

function setup({error=false}={}){
 const calls=[];
 const profiles=Array.from({length:35},(_,i)=>({id:id(i+1),username:"member"+(i+1)}));
 const owner=id(999);
 const db={from(table){
   const call={table};calls.push(call);
   const query={
     select(columns){call.columns=columns;return query;},
     order(){return query;},
     eq(k,v){call.eq=[k,v];return query;},
     in(k,values){call.in=[k,values];return query;},
     limit(size){
       call.limit=size;
       if(table==="public_profiles")return Promise.resolve({data:profiles.slice(0,size),error:null});
       if(table==="friendships"){
         if(error)return Promise.resolve({data:null,error:{message:"unavailable"}});
         if(call.eq[0]==="requester_id")
           return Promise.resolve({data:[{addressee_id:id(1)},{addressee_id:id(2)}],error:null});
         return Promise.resolve({data:[{requester_id:id(3)}],error:null});
       }
       throw Error("Unexpected table "+table);
     }
   };return query;
 }};
 const context={supabase:db,reportAppError(){},getDisplayName(){},console,Date,Set,Map,Object,Number,String};
 vm.runInNewContext(source+"\nthis.api={fetchSuggestedPeople};",context);
 return {fetchSuggestedPeople:context.api.fetchSuggestedPeople,calls,owner};
}
test("suggestions query only bounded candidate relationships",async()=>{
 const {fetchSuggestedPeople,calls,owner}=setup();
 const result=await fetchSuggestedPeople(owner,8);
 assert.equal(result.length,8);
 assert.deepEqual(result.map(x=>x.id),Array.from({length:8},(_,i)=>id(i+4)));
 assert.equal(calls[0].limit,32);
 assert.equal(calls.length,3);
 assert.ok(calls.slice(1).every(c=>c.table==="friendships"&&c.limit===32));
 assert.deepEqual(calls[1].eq,["requester_id",owner]);
 assert.deepEqual(calls[2].eq,["addressee_id",owner]);
 assert.equal(calls[1].in[1].length,32);
 assert.equal(calls[2].in[1].length,32);
 assert.doesNotMatch(source,/or\(\`requester_id\.eq\./);
});
test("fail closed when candidate relationship lookup is unavailable",async()=>{
 const {fetchSuggestedPeople,owner}=setup({error:true});
 const users=await fetchSuggestedPeople(owner,8);
 assert.equal(users.length,0);
});
test("suggestion limits are enforced even when callers request thousands",async()=>{
 const {fetchSuggestedPeople,calls,owner}=setup();
 const users=await fetchSuggestedPeople(owner,99999);
 assert.ok(users.length<=24);
 assert.equal(calls[0].limit,96);
});

test("homepage suggested people and leaderboard use trusted current verification badges",()=>{
 const app=fs.readFileSync(path.resolve(__dirname,"../assets/js/app.js"),"utf8");
 const data=fs.readFileSync(path.resolve(__dirname,"../assets/js/data.js"),"utf8");
 const css=fs.readFileSync(path.resolve(__dirname,"../assets/css/home.css"),"utf8");
 const queries=[
   data.slice(data.indexOf("export async function fetchTopProfiles"),data.indexOf("export async function fetchSuggestedPeople")),
   data.slice(data.indexOf("export async function fetchSuggestedPeople"),data.indexOf("export async function sendFriendRequestTo"))
 ];
 for(const source of queries)for(const field of ["is_verified","verification_tier","verification_expires_at","frame_style"])
   assert.ok(source.includes(field),"Missing trusted verification field "+field);
 assert.ok(app.includes('import {verifiedAvatar,verifiedName} from "./verified-identity.mjs";'));
 assert.ok(app.includes('verifiedAvatar(profile.avatar_url,profile,'));
 assert.equal(app.split('verifiedName(name,profile,{compact:true})').length-1,2);
 assert.ok(!app.includes('class="verified-badge small"'));
 assert.ok(css.includes('.people-card-avatar .tz-avatar-verified > img'));
 assert.ok(css.includes('.people-card-name .tz-identity-name'));
});
