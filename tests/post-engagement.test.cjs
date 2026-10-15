const test = require("node:test");
const assert = require("node:assert/strict");
const helper = import("../assets/js/post-engagement.mjs");
const ids = ["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];

test("engagement RPC returns exact counts without row downloads", async () => {
  const {fetchPostEngagement} = await helper;
  let calls=0;
  const sb = {rpc:async (name, args) => {
    calls++;
    assert.equal(name,"get_post_engagement");
    return {data:args.p_post_ids.map((id,i)=>({post_id:id,like_count:i+10,comment_count:i+1,liked_by_me:i===0})),error:null};
  },from:()=>{throw Error("Unbounded row retrieval must not run");}};
  const x=await fetchPostEngagement(sb,[...ids,ids[0]]);
  assert.equal(calls,1);
  assert.equal(x.likeCounts[ids[0]],10);
  assert.equal(x.commentCounts[ids[1]],2);
  assert.deepEqual(x.likedPostIds,[ids[0]]);
});

test("missing RPC uses exact count requests with bounded work", async () => {
  const {fetchPostEngagement} = await helper;
  let active=0,peak=0,countReads=0;
  const sb={rpc:async()=>({error:{code:"PGRST202"}}),from:table=>({
    select(fields,opts){
      assert.ok(opts?.head || table==="post_likes");
      return this;
    },
    eq(key,value){this.key=key;return this;},
    in(){return Promise.resolve({data:[],error:null});},
    async then(resolve){ countReads++;active++;peak=Math.max(peak,active);await Promise.resolve();active--;resolve({count:table==="post_likes"?7:3,error:null}); }
  })};
  const x=await fetchPostEngagement(sb,ids);
  assert.equal(x.likeCounts[ids[0]],7);
  assert.equal(x.commentCounts[ids[1]],3);
  assert.equal(countReads,4);
  assert.ok(peak<=8);
});

test("permission errors are not converted to fake zero counts", async () => {
  const {fetchPostEngagement} = await helper;
  await assert.rejects(fetchPostEngagement({rpc:async()=>({error:{code:"42501"}})},ids), e=>e.code==="42501");
});
