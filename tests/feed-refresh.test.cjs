const test = require("node:test");
const assert = require("node:assert/strict");
const { allowedBatch,maybeRefreshFeedCandidates } = require("../netlify/functions/_lib/feed-refresh.cjs");
test("recommendation refresh is strictly disabled by default", async () => {
  const result = await maybeRefreshFeedCandidates({rpc(){throw Error("must not hit DB")}},{});
  assert.equal(result.skipped,"disabled");
});
test("enabled recommendation refresh bounds candidate work and records a real result", async () => {
  let calls=0;
  const sb={rpc:async (fn,args)=>{calls++;assert.equal(fn,"refresh_feed_candidate_scores");assert.equal(args.p_max_per_type,250);return {data:{candidates:480},error:null}}};
  assert.deepEqual(await maybeRefreshFeedCandidates(sb,{FEED_CANDIDATE_REFRESH_ENABLED:"true",FEED_CANDIDATE_BATCH_SIZE:"999999"}),{candidates:480});
  assert.equal(calls,1);
});
test("recommender worker surfaces function failures", async () => {
  const error={code:"42501",message:"not authorized"};
  await assert.rejects(maybeRefreshFeedCandidates({rpc:async()=>({error})},{FEED_CANDIDATE_REFRESH_ENABLED:"true"}),e=>e===error);
  assert.equal(allowedBatch("nope"),150);
});
