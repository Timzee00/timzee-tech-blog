"use strict";
/* Staff-only moderation investigation API.
 * Evidence is read after validating the staff session against the live
 * profile role. Final decisions are one atomic, replay-safe database RPC.
 */
const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const {parseJsonObject}=require("./_lib/request.js");
const {randomUUID}=require("node:crypto");
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const reply=(statusCode,data)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"},body:JSON.stringify(data)});
const targetSchemas=Object.freeze({
 user:{table:"profiles",fields:"id,display_name,username,role,account_status",owner:"id",text:"display_name"},
 profile:{table:"profiles",fields:"id,display_name,username,role,account_status",owner:"id",text:"display_name"},
 post:{table:"posts",fields:"id,title,content,author_id,status,created_at",owner:"author_id",text:"content"},
 posts:{table:"posts",fields:"id,title,content,author_id,status,created_at",owner:"author_id",text:"content"},
 comment:{table:"comments",fields:"id,body,author_id,status,post_id,created_at",owner:"author_id",text:"body"},
 comments:{table:"comments",fields:"id,body,author_id,status,post_id,created_at",owner:"author_id",text:"body"},
 discussion_message:{table:"discussion_messages",fields:"id,body,author_id,thread_id,moderation_status,created_at",owner:"author_id",text:"body"},
 marketplace_item:{table:"marketplace_items",fields:"id,title,description,user_id,is_available,created_at",owner:"user_id",text:"description"},
 video:{table:"videos",fields:"id,title,description,user_id,is_public,created_at",owner:"user_id",text:"description"},
 novel:{table:"novels",fields:"id,title,author_id,status,created_at",owner:"author_id",text:"title"},
 direct_message:{table:"direct_messages",fields:"id,body,sender_id,recipient_id,deleted_at,created_at",owner:"sender_id",text:"body"}
});
const trimmed=(value,n=1600)=>String(value||"").slice(0,n);
// Present an excerpt for review without executing or displaying raw article markup.
const excerpt=(value,n=1200)=>trimmed(String(value||"").replace(/<script[^>]*>[\s\S]*?<\/script>/gi," ")
 .replace(/<style[^>]*>[\s\S]*?<\/style>/gi," ")
 .replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim(),n);
function parseRequest(body){
 const kind=String(body.kind||"decision");
 if(kind==="flag_review"){
   const id=Number(body.flagId),decision=String(body.decision||"");
   const note=trimmed(body.reason,2500).trim();
   if(!Number.isSafeInteger(id)||id<=0||!uuid.test(body.requestId||"")||
     !["approve","hide","dismiss"].includes(decision)||note.length<20||note.length>2000)
     return {error:"Choose a flagged item, decision, and investigation reason of at least 20 characters."};
   return {kind,flagId:id,decision,reason:note,requestId:body.requestId};
 }
 if(kind==="reinstate"){
   if(!uuid.test(body.targetId||"")||!uuid.test(body.requestId||"")||trimmed(body.reason,2500).trim().length<20)
     return {error:"Choose a valid account and explain why its restriction should be lifted."};
   return {kind,targetId:body.targetId,requestId:body.requestId,reason:trimmed(body.reason,2000).trim()};
 }
 const outcome=String(body.outcome||""),action=String(body.action||"none");
 const allowedActions=["none","warn","hide","suspend_24h","suspend_7d","ban"];
 const reason=trimmed(body.reason,2500).trim(),evidence=trimmed(body.evidence,2500).trim();
 if(!uuid.test(body.reportId||"")||!uuid.test(body.requestId||"")||
   !["investigating","confirmed","dismissed"].includes(outcome)||
   !allowedActions.includes(action)||reason.length<20||reason.length>2000||evidence.length<20||evidence.length>2000)
   return {error:"Select a decision and provide at least 20 characters of rationale and evidence notes."};
 if(outcome!=="confirmed"&&action!=="none")return {error:"Only a confirmed violation may trigger an enforcement action."};
 return {kind:"decision",reportId:body.reportId,requestId:body.requestId,outcome,action,reason,evidence};
}
async function profilePreview(db,id){
 if(!uuid.test(id||""))return null;
 const {data,error}=await db.from("profiles").select("id,display_name,username,role,account_status").eq("id",id).maybeSingle();
 if(error)throw Error("Cannot inspect account information");
 return data||null;
}
async function flagDetail(db,id){
 const record=await db.from("moderation_automated_flags")
  .select("id,target_type,target_id,risk_score,signals,state,created_at,updated_at").eq("id",id).maybeSingle();
 if(record.error)throw Error("Automatic moderation queue is unavailable");
 const flag=record.data;
 if(!flag)return null;
 const type=targetSchemas[flag.target_type];
 let preview=null,subject=null,ownerId=null;
 if(type){
  const row=await db.from(type.table).select(type.fields).eq("id",flag.target_id).maybeSingle();
  if(row.error)throw Error("Reported item could not be reviewed");
  if(row.data){
   const raw=row.data;
   ownerId=raw[type.owner]||null;
   preview={title:trimmed(raw.title||raw.display_name||"",200),
    text:excerpt(raw[type.text],1200),created_at:raw.created_at||null,
    status:raw.status||raw.moderation_status||(raw.is_available===false||raw.is_public===false?"Hidden":"Available")};
  }
 }
 subject=await profilePreview(db,ownerId);
 return {flag,preview,subject};
}
async function caseDetail(db,id){
 const result=await db.from("content_reports").select("id,reporter_id,content_type,content_id,reason,status,created_at,resolved_at,resolved_by,investigation_state").eq("id",id).maybeSingle();
 if(result.error)throw Error("Cannot retrieve report");
 const report=result.data;
 if(!report)return null;
 const schema=targetSchemas[report.content_type];
 let subjectId=null,preview=null,accessNote=null;
 if(schema){
   const res=await db.from(schema.table).select(schema.fields).eq("id",report.content_id).maybeSingle();
   if(res.error)throw Error("Unable to review reported content");
   const raw=res.data;
   if(raw){
     if(report.content_type==="direct_message"&&
        ![raw.sender_id,raw.recipient_id].includes(report.reporter_id)){
       accessNote="Reporter was not a participant in this message. The message body is withheld.";
     }else{
       subjectId=report.content_type==="direct_message"?
         (report.reporter_id===raw.recipient_id?raw.sender_id:null):raw[schema.owner];
       preview={id:raw.id,type:report.content_type,
         title:trimmed(raw.title||raw.display_name||"",180),
         text:raw.deleted_at?"[Previously deleted message]":excerpt(raw[schema.text],1200),
         created_at:raw.created_at||null,status:raw.status||raw.moderation_status||
           (raw.is_available===false||raw.is_public===false?"Not public":"Available")};
     }
   }else accessNote="Reported content is unavailable or was removed.";
 }else accessNote="This report category requires a separate specialist investigation.";
 const [reporter,subject,notes,history,sanctions,flags,legacy]=await Promise.all([
   profilePreview(db,report.reporter_id),
   profilePreview(db,subjectId),
   db.from("moderation_case_notes").select("id,outcome,action,reason,evidence_summary,created_at,reviewer_id").eq("report_id",id).order("created_at",{ascending:false}).limit(30),
   db.from("content_reports").select("id",{count:"exact",head:true}).eq("content_type",report.content_type).eq("content_id",report.content_id),
   subjectId?db.from("moderation_account_actions").select("id,action,reason,ends_at,lifted_at,created_at,actor_id").eq("target_id",subjectId).order("created_at",{ascending:false}).limit(15):Promise.resolve({data:[],error:null}),
   db.from("moderation_automated_flags").select("id,signals,risk_score,state,created_at").eq("target_type",report.content_type).eq("target_id",report.content_id).limit(1),
   db.from("moderation_audit").select("action,created_at,moderator_id").eq("content_type","content_reports").eq("content_id",id).order("created_at",{ascending:false}).limit(20)
 ]);
 if(notes.error||history.error||sanctions.error||legacy.error){throw Error("Report investigation history unavailable");}
 // Automatic flags are an optional, strictly server-owned enrichment.
 return {report,preview,accessNote,reporter,subject,subjectId,
   notes:notes.data||[],legacyActions:legacy.data||[],relatedReportCount:history.count||0,sanctions:sanctions.data||[],
   automaticFlags:flags.error?[]:(flags.data||[])};
}
exports.handler=async event=>{
 if(!["GET","POST"].includes(event.httpMethod))return reply(405,{error:"GET or POST required"});
 const authHeader=event.headers?.authorization||event.headers?.Authorization||"";
 const token=/^Bearer\s+\S+$/i.test(authHeader)?authHeader.replace(/^Bearer\s+/i,"").trim():"";
 if(!token)return reply(401,{error:"Sign in to the moderation panel."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return reply(503,{error:"Moderation service is not configured"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
   const role=await requireRole(db,token,["moderator","admin","super"],"Moderator access required");
   if(role.error)return reply(403,{error:"Your moderator account is not authorized or is inactive."});
   if(event.httpMethod==="GET"){
     const query=event.queryStringParameters||{};
     if(query.queue==="flags"){
       const page=Math.max(0,Math.min(1000,Number.parseInt(query.page||"0",10)||0));
       const status=["pending","reviewed","dismissed","all"].includes(query.status)?query.status:"pending";
       let request=db.from("moderation_automated_flags")
        .select("id,target_type,target_id,risk_score,signals,state,created_at",{count:"exact"});
       if(status!=="all")request=request.eq("state",status);
       const {data,error,count}=await request.order("risk_score",{ascending:false})
        .order("created_at",{ascending:true}).range(page*40,page*40+39);
       if(error)throw Error("Automatic review queue unavailable");
       return reply(200,{ok:true,flags:data||[],total:Number(count||0),page});
     }
     if(query.flag){
       const id=Number(query.flag);
       if(!Number.isSafeInteger(id)||id<=0)return reply(400,{error:"Invalid safety flag identifier"});
       const details=await flagDetail(db,id);
       return details?reply(200,{ok:true,details}):reply(404,{error:"Flag not found"});
     }
     if(query.id){
       if(!uuid.test(query.id))return reply(400,{error:"Invalid report identifier"});
       const data=await caseDetail(db,query.id);
       return data?reply(200,{ok:true,case:data}):reply(404,{error:"Report not found"});
     }
     const filter=["open","investigating","resolved","dismissed","all"].includes(query.status)?query.status:"open";
     const page=Math.max(0,Math.min(1000,Number.parseInt(query.page||"0",10)||0));
     const search=String(query.search||"").trim();
     if(search.length>80)return reply(400,{error:"Search must be 80 characters or fewer."});
     let request=db.from("content_reports").select("id,content_type,content_id,reason,status,created_at,investigation_state",{count:"exact"});
     if(filter==="investigating")request=request.eq("status","open").eq("investigation_state","investigating");
     else if(filter!=="all")request=request.eq("status",filter);
     if(search){
       if(uuid.test(search))request=request.or("id.eq."+search+",content_id.eq."+search);
       else if(Object.hasOwn(targetSchemas,search.toLowerCase()) || search.toLowerCase()==="chat_group")
         request=request.eq("content_type",search.toLowerCase());
       else {
         // Escape LIKE wildcards: searches should not unexpectedly scan every case.
         const literal=search.replace(/[\\%_]/g,match=>"\\"+match);
         request=request.ilike("reason","%"+literal+"%");
       }
     }
     const {data,error,count}=await request.order("created_at",{ascending:false}).range(page*40,page*40+39);
     if(error)throw Error("Cannot load moderation queue");
     return reply(200,{ok:true,reports:data||[],total:Number(count||0),page,pageSize:40});
   }
   const parsed=parseJsonObject(event,8192);
   if(parsed.error)return reply(parsed.statusCode,{error:parsed.error});
   const input=parseRequest(parsed.payload);
   if(input.error)return reply(400,{error:input.error});
   let data,error;
   if(input.kind==="flag_review"){
     ({data,error}=await db.rpc("staff_review_automated_flag",{
       p_actor:role.user.id,p_flag:input.flagId,p_decision:input.decision,
       p_reason:input.reason,p_request:input.requestId
     }));
   }else if(input.kind==="reinstate"){
     ({data,error}=await db.rpc("staff_lift_account_restriction",{
       p_actor:role.user.id,p_target:input.targetId,p_reason:input.reason,p_request:input.requestId
     }));
   }else{
     ({data,error}=await db.rpc("staff_decide_content_report",{
       p_actor:role.user.id,p_report:input.reportId,p_outcome:input.outcome,
       p_action:input.action,p_reason:input.reason,p_evidence:input.evidence,p_request:input.requestId
     }));
   }
   if(error){
     if(error.code==="23505")return reply(409,{error:"This case was already decided or the request was reused."});
     if(error.code==="42501")return reply(403,{error:"You do not have permission for this moderation decision."});
     if(error.code==="P0002")return reply(404,{error:"The report or account is no longer available."});
     if(error.code==="22023")return reply(400,{error:"This action is not supported for the reported target or its current state."});
     console.error("Moderation investigation RPC failed",String(error.code||"DB_ERROR"));
     return reply(503,{error:"The decision could not be recorded. No action was confirmed."});
   }
   if(data?.ok!==true)return reply(503,{error:"The moderation result could not be verified."});
   return reply(200,{ok:true,decision:data});
 }catch(err){
   console.error("Moderation investigation unavailable",err?.message||"unknown");
   return reply(503,{error:"Moderation information is temporarily unavailable."});
 }
};
exports._test={parseRequest,targetSchemas};
