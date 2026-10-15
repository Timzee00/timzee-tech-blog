import { supabase } from "./supabase.js";

const TYPES=new Set(["user","direct_message","chat_group"]);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Use a single RLS-governed moderation queue. Report identifiers, not copies
 * of private chat text in browser-generated metadata.
 */
export async function submitModerationReport({
  reporterId, contentType, contentId, reason, metadata = {}
}) {
  if(!UUID.test(String(reporterId||""))||!UUID.test(String(contentId||"")))
    throw Error("This report requires a valid signed-in user and content ID.");
  if(!TYPES.has(contentType)) throw Error("Unsupported report type.");
  const description=String(reason||"").trim();
  if(description.length<8||description.length>500) throw Error("Please give a reason between 8 and 500 characters.");
  if(reporterId===contentId&&contentType==="user")throw Error("You cannot report your own account.");
  const safe={source:"timzee-moderation",...(contentType==="direct_message"&&typeof metadata.threadId==="string"?
    {thread_id:metadata.threadId.slice(0,100)}:{})};
  const result=await supabase.from("content_reports").insert({
    id:crypto.randomUUID(),reporter_id:reporterId,content_type:contentType,
    content_id:contentId,reason:description,status:"open",metadata:safe
  });
  if(result.error)throw result.error;
  return true;
}
