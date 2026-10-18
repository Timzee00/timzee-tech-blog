/* Server-only verification moderation. No service credentials reach the browser.
 * All decisions are audited and evidence is private with short-lived previews. */
const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const {parseJsonObject}=require("./_lib/request.js");
const json=(statusCode,data)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(data)});
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

exports.handler=async event=>{
  const method=String(event.httpMethod||"").toUpperCase();
  if(!["GET","POST"].includes(method))return json(405,{error:"Method not allowed."});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return json(503,{error:"Verification administration is unavailable."});
  const header=event.headers?.authorization||event.headers?.Authorization||"";
  const token=header.replace(/^Bearer\s+/i,"");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const guard=await requireRole(db,token,["admin","super"],"Administrator access required.");
  if(guard.error)return json(guard.error.includes("token")?401:403,{error:guard.error});
  if(method==="GET"){
    const id=String(event.queryStringParameters?.applicationId||"");
    const index=Number(event.queryStringParameters?.proofIndex);
    if(id){
      if(!uuid.test(id)||!Number.isInteger(index)||index<0||index>4)return json(400,{error:"Invalid evidence request."});
      const {data,error}=await db.from("verification_applications")
        .select("id,documents").eq("id",id).maybeSingle();
      if(error||!data)return json(404,{error:"Verification application unavailable."});
      const file=Array.isArray(data.documents)?data.documents[index]:null;
      if(!file?.path||!file.path.match(/^[a-f0-9-]{36}\//i))
        return json(404,{error:"Evidence file unavailable."});
      const signed=await db.storage.from("verification-proofs").createSignedUrl(file.path,120);
      if(signed.error||!signed.data?.signedUrl)return json(404,{error:"Cannot securely open evidence."});
      return json(200,{url:signed.data.signedUrl,expires_in_seconds:120});
    }
    const page=Math.max(1,Math.min(10,Number.parseInt(event.queryStringParameters?.page||"1",10)||1));
    const start=(page-1)*25;
    const {data,error}=await db.from("verification_applications")
      .select("id,user_id,user_email,user_name,verification_type,message,documents,status,triage_flags,triage_score,created_at", {count:"exact"})
      .eq("status","pending").order("created_at",{ascending:true}).range(start,start+24);
    if(error)return json(500,{error:"Unable to load the verification queue."});
    // Return only document type and index; signed URLs require another authorized request.
    const sanitized=(data||[]).map(row=>({
      ...row,
      documents:(Array.isArray(row.documents)?row.documents:[])
        .map((file,index)=>({index,type:String(file?.type||"unknown").slice(0,55)}))
    }));
    return json(200,{applications:sanitized,page,hasMore:(start+sanitized.length)<(data?.count||0)});
  }
  const parsed=parseJsonObject(event);
  if(parsed.error)return json(parsed.statusCode,{error:parsed.error});
  const input=parsed.payload||{};
  const applicationId=String(input.applicationId||"");
  const decision=String(input.decision||"").trim();
  const level=String(input.level||"").trim();
  const note=String(input.note||"").trim();
  if(!uuid.test(applicationId)||!["approved","rejected"].includes(decision)||
    (decision==="approved"&&!["silver","gold","platinum","business"].includes(level))||
    note.length<25||note.length>1800)
    return json(400,{error:"Provide a valid application, decision, level and a detailed review note (25–1800 characters)."});
  if(decision==="approved"&&level==="business"&&guard.role!=="super")
    return json(403,{error:"Official organization approval requires a super administrator."});
  const result=await db.rpc("review_verification_application",{
    p_application:applicationId,p_reviewer:guard.user.id,
    p_decision:decision,p_level:decision==="approved"?level:null,p_note:note
  });
  if(result.error){
    const isDenied=/required|unavailable|missing|already reviewed|identity evidence/i.test(result.error.message||"");
    return json(isDenied?409:400,{error:result.error.message||"Verification review could not complete."});
  }
  return json(200,{review:result.data});
};
