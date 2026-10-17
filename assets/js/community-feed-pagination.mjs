// Pure pagination helpers for database-ranked Timzee community feeds.
// Kept separate so cursor and duplicate behavior can be regression-tested.
const HEX_UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function communityRankCursor(row){
 if(!row||!HEX_UUID.test(String(row.id||""))||row.recommendation_score===null||row.recommendation_score===undefined||row.recommendation_score===""||!Number.isFinite(Number(row.recommendation_score))
    ||!Number.isFinite(Date.parse(row.created_at||"")))return null;
 return {
   p_after_score:Number(row.recommendation_score),
   p_after_created:row.created_at,
   p_after_id:row.id
 };
}
export function appendUniqueCommunityRows(previous,incoming){
 const result=[...(Array.isArray(previous)?previous:[])];
 const ids=new Set(result.map(row=>row?.id).filter(Boolean));
 for(const row of Array.isArray(incoming)?incoming:[]){
   if(!row||!HEX_UUID.test(String(row.id||""))||ids.has(row.id))continue;
   ids.add(row.id);result.push(row);
 }
 return result;
}
// Both values are elapsed, monotonic milliseconds (performance.now()), not
// wall-clock dates. Phones with incorrect time must still browse normally.
export function isCommunitySnapshotStale(startMs,nowMs,maxAgeMs=210*60*1000){
 return !Number.isFinite(startMs)||!Number.isFinite(nowMs)
   ||startMs<0||nowMs<startMs||nowMs-startMs>maxAgeMs;
}
