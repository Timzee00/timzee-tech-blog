const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const ROOT=join(__dirname,'..');
const load=path=>readFileSync(join(ROOT,path),'utf8');
const OWNER='11111111-1111-4111-8111-111111111111';
const VIEWER='22222222-2222-4222-8222-222222222222';
const STORY='33333333-3333-4333-8333-333333333333';
const FILE='44444444-4444-4444-8444-444444444444';
const media='story-private-media/'+OWNER+'/'+FILE+'.mp4';
const music='story-private-media/'+OWNER+'/music/'+FILE+'.mp3';

function signer({actor=VIEWER,accepted=false,expires=Date.now()+600000,visibility='private'}={}){
 const activity={signs:0,friendLookups:0};
 const story={id:STORY,user_id:OWNER,visibility,
  expires_at:new Date(expires).toISOString(),media_url:media,music_url:music};
 const db={
  auth:{getUser:async token=>token==='valid'
    ?{data:{user:{id:actor}},error:null}:{data:{user:null},error:{message:'bad'}}},
  from(table){
    if(table==='stories')return {
      select:()=>({eq:()=>({maybeSingle:async()=>({data:story,error:null})})})
    };
    if(table==='friendships')return {
      select:()=>({eq:()=>({or:()=>({limit:async()=>{
        activity.friendLookups++;return {data:accepted?[{id:FILE}]:[],error:null};
      }})})})
    };
    throw Error('Unexpected table '+table);
  },
  storage:{from(bucket){
    assert.equal(bucket,'story-private-media');
    return {createSignedUrl:async(path,ttl)=>{
      activity.signs++;assert.equal(ttl,300);
      return {data:{signedUrl:'https://signed.example/'+path},error:null};
    }};
  }}
 };
 const context={
  exports:{},console:{error(){}},process:{env:{
    SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only'
  }},
  require(name){
    if(name==='@supabase/supabase-js')return {createClient:()=>db};
    if(name==='./_lib/request.js')return {parseJsonObject:event=>({
      payload:JSON.parse(event.body||'{}')
    })};
    throw Error('Unexpected dependency '+name);
  }
 };
 vm.runInNewContext(load('netlify/functions/story-private-media.js'),context,{timeout:2000});
 const request=async(asset='media',token='valid')=>{
   const response=await context.exports.handler({
     httpMethod:'POST',
     headers:token?{authorization:'Bearer '+token}:{},
     body:JSON.stringify({story_id:STORY,asset})
   });
   return {status:response.statusCode,body:JSON.parse(response.body)};
 };
 return {request,activity};
}
test('private status signing refuses anonymous access without storage access',async()=>{
 const {request,activity}=signer({accepted:true});
 const response=await request('media','');
 assert.equal(response.status,401);assert.equal(activity.signs,0);
});
test('private status signing refuses nonfriends even when story ID is known',async()=>{
 const {request,activity}=signer({accepted:false});
 assert.equal((await request()).status,403);
 assert.equal(activity.friendLookups,1);
 assert.equal(activity.signs,0);
});
test('accepted friends get five-minute URLs but not raw storage credentials',async()=>{
 const {request,activity}=signer({accepted:true});
 const response=await request();
 assert.equal(response.status,200);
 assert.equal(response.body.expiresIn,300);
 assert.match(response.body.signedUrl,new RegExp(OWNER));
 assert.equal(activity.signs,1);
});
test('story owner can securely access own private soundtrack',async()=>{
 const {request}=signer({actor:OWNER});
 const response=await request('music');
 assert.equal(response.status,200);
 assert.match(response.body.signedUrl,/music\//);
});
test('expired stories never issue private media URLs',async()=>{
 const {request,activity}=signer({expires:Date.now()-60000,accepted:true});
 assert.equal((await request()).status,404);
 assert.equal(activity.signs,0);
});
test('public status cannot be signed through private endpoint',async()=>{
 const {request,activity}=signer({visibility:'public',accepted:true});
 assert.equal((await request()).status,404);
 assert.equal(activity.signs,0);
});
test('verified status and owner-only storage are enforced by committed migrations',()=>{
 const sql=load('supabase/migrations/20261017003500_server_clock_verified_story_publishing.sql');
 const storage=load('supabase/migrations/20261017001000_private_story_storage.sql');
 assert.match(sql,/p_duration_hours>24 AND NOT v_verified/);
 assert.match(sql,/now\(\)\+make_interval\(hours=>p_duration_hours\)/);
 assert.match(sql,/private status must reference owner-only storage/i);
 assert.match(storage,/public=false/);
 assert.match(storage,/storage\.foldername\(name\)/);
 assert.match(storage,/auth\.uid\(\)/);
});
test('Brevo transactional worker has one explicit 15-minute schedule',()=>{
 const toml=load('netlify.toml');
 const worker=load('netlify/functions/email-worker.js');
 assert.match(toml,/\[functions\."email-worker"\]\s*schedule\s*=\s*"\*\/15 \* \* \* \*"/);
 assert.doesNotMatch(worker,/exports\.config\s*=\s*\{\s*schedule/);
 assert.match(worker,/EMAIL_DELIVERY_ENABLED\s*!==\s*"true"/);
 assert.match(worker,/claim_email_jobs/);
 assert.match(worker,/is_email_suppressed/);
});

test('verified translation usage is tracked in Postgres rather than worker memory',()=>{
 const worker=load('netlify/functions/verified-translate.js');
 const migration=load('supabase/migrations/20261017004500_verified_translation_quota.sql');
 assert.match(worker,/consume_verified_translation_quota/);
 assert.doesNotMatch(worker,/const recent=new Map/);
 assert.match(migration,/ON CONFLICT\(user_id,window_start\)/);
 assert.match(migration,/requests<18/);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
});

test('Status discovery keeps the creator and viewer controls and hides private previews',()=>{
 const html=load('stories.html'),css=load('assets/css/blipmood-status-refresh.css');
 const interactions=load('assets/js/story-interactions.mjs');
 for(const id of ['storiesRail','storiesEmpty','statusHighlights','statusGalleryMore','storyLoadMore',
  'savedStoryToggle','storyViewer','storyViewerMedia','storyViewerSocial','storyComposer',
  'storyFile','storyCaption','storyMusicFile','storyDuration','storyVisibility','viewerSequence']){
  const key=id==='storyVisibility'?'name="storyVisibility"':'id="'+id+'"';
  assert.ok(html.includes(key),'Missing '+key);
 }
 assert.match(html,/data-story-filter="friends"/);
 assert.match(html,/newest\.visibility!=="private"&&newest\.media_type==="image"/);
 assert.match(html,/newest\.caption\|\|/);
 assert.match(html,/state\.galleryExpanded/);
 assert.match(html,/profile\?\.username/);
 assert.match(html,/profile\?\.display_name/);
 assert.match(html,/story-private-media/);
 assert.match(css,/\.status-gallery-grid\{display:grid/);
 assert.match(css,/\.story-social-actions\{display:grid/);
 assert.match(css,/@media\(max-width:680px\)/);
 for(const action of ['like','reply','share','save','reshare','poll'])
  assert.ok(interactions.includes('data-action="'+action+'"'),'Missing '+action);
 assert.match(interactions,/story-extra-menu/);
 assert.match(interactions,/story-comments-panel/);
 assert.match(html,/fetchStoriesFeedPage\(\{cursor:state\.storyNextCursor\}\)/);
});

test('Status feed fetch is bounded and keyset pagination keeps multi-status authors intact',async()=>{
 const source=load('assets/js/stories.js').split('\n')
  .filter(line=>!line.trim().startsWith('import '))
  .map(line=>line.replace(/^export /,'')).join('\n');
 const id=n=>'33333333-3333-4333-8333-'+String(n).padStart(12,'0');
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 const rows=[
  {id:id(4),user_id:a,created_at:'2026-10-30T12:04:00Z'},
  {id:id(3),user_id:b,created_at:'2026-10-30T12:03:00Z'},
  {id:id(2),user_id:a,created_at:'2026-10-30T12:02:00Z'},
  {id:id(1),user_id:b,created_at:'2026-10-30T12:01:00Z'}
 ];
 const trace={};
 const query={
  select(){return this;},order(name,opts){(trace.orders??=[]).push([name,opts.ascending]);return this;},
  limit(n){trace.limit=n;return this;},or(cursor){trace.cursor=cursor;return this;},
  then(ok,bad){return Promise.resolve({data:rows,error:null}).then(ok,bad);}
 };
 const client={from(table){
  if(table==='stories')return query;
  if(table==='public_profiles')return {select(){return this;},in(name,ids){
   trace.profiles=ids;return Promise.resolve({data:[{id:a,username:'a'},{id:b,username:'b'}],error:null});
  }};
  throw Error('Unexpected table '+table);
 }};
 const fetchPage=vm.runInNewContext(source+';fetchStoriesFeedPage',
  {supabase:client,uploadMedia(){},console},{timeout:2000});
 const page=await fetchPage({limit:3});
 assert.equal(trace.limit,4);
 assert.equal(page.hasMore,true);
 assert.equal(page.groups.length,2);
 assert.deepEqual(Array.from(page.groups[0].stories,story=>story.id),[id(2),id(4)]);
 assert.equal(page.nextCursor.id,id(2));
 await fetchPage({limit:3,cursor:page.nextCursor});
 assert.match(trace.cursor,/created_at\.lt\./);
 assert.match(trace.cursor,/id\.lt\./);
 await assert.rejects(()=>fetchPage({cursor:{created_at:'bad',id:'bad'}}),/Invalid status feed cursor/);
});
