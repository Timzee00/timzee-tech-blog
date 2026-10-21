/* Owner-only, bounded moderation triage. No raw documents, reporter identities,
   private messages, or service credentials are returned to the browser. */
const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const PAGE_SIZE=15;
const MAX_PAGE=50;
const SOURCES=Object.freeze({
  reports:{table:"content_reports",statusColumn:"status",status:"open",
    fields:"id,content_type,content_id,reason,created_at"},
  community:{table:"community_reports",statusColumn:"status",status:"pending",
    fields:"id,community_id,target_type,target_id,reason,created_at"},
  automod:{table:"community_auto_moderation",statusColumn:"state",status:"pending",
    fields:"id,community_id,target_type,target_id,signals,risk_score,created_at"}
});
const json=(statusCode,body)=>({statusCode,headers:{
  "Content-Type":"application/json","Cache-Control":"private, no-store",
  "X-Content-Type-Options":"nosniff"
},body:JSON.stringify(body)});
const clean=(value,limit)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,limit);
function parsePage(query={}){
  const kind=String(query.kind||"reports");
  const raw=String(query.page||"1");
  if(!Object.prototype.hasOwnProperty.call(SOURCES,kind)||
     !/^[1-9]\d{0,1}$/.test(raw))return null;
  const page=Number(raw);
  if(page>MAX_PAGE)return null;
  return{kind,page};
}
function sanitize(item,kind){
  const base={kind,id:item.id,targetType:clean(item.content_type||item.target_type,40),
    targetId:clean(item.content_id||item.target_id,40),
    communityId:clean(item.community_id,40),
    createdAt:item.created_at||null};
  if(kind==="automod")return {...base,riskScore:Math.max(0,Math.min(100,Number(item.risk_score)||0)),
    signals:(Array.isArray(item.signals)?item.signals:[]).slice(0,6).map(s=>clean(s,50))};
  return {...base,reason:clean(item.reason,350)};
}
async function getInbox(db,kind,page){
  const source=SOURCES[kind];
  let query=db.from(source.table)
    .select(source.fields,{count:"exact"})
    .eq(source.statusColumn,source.status);
  if(kind==="automod")query=query.order("risk_score",{ascending:false});
  query=query.order("created_at",{ascending:true});
  const start=(page-1)*PAGE_SIZE;
  const {data,error,count}=await query.range(start,start+PAGE_SIZE-1);
  if(error)throw error;
  const items=(Array.isArray(data)?data:[]).map(row=>sanitize(row,kind));
  return{kind,page,pageSize:PAGE_SIZE,items,
    total:Number.isInteger(count)?count:null,
    hasMore:Number.isInteger(count)?start+items.length<count:items.length===PAGE_SIZE};
}
exports.handler=async event=>{
  if(event.httpMethod!=="GET")return json(405,{error:"GET required."});
  const header=event.headers?.authorization||event.headers?.Authorization||"";
  const token=/^Bearer\s+\S+$/i.test(header)?header.replace(/^Bearer\s+/i,"").trim():"";
  if(!token)return json(401,{error:"Sign in as an administrator."});
  const parsed=parsePage(event.queryStringParameters);
  if(!parsed)return json(400,{error:"Choose a valid queue and page."});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return json(503,{error:"Operations inbox is unavailable."});
  try{
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const guard=await requireRole(db,token,["admin","super"],"Administrator access required.");
    if(guard.error)return json(/token/i.test(guard.error)?401:403,{error:guard.error});
    return json(200,await getInbox(db,parsed.kind,parsed.page));
  }catch(error){
    console.error("Operations inbox query failed",error?.code||"unknown");
    return json(503,{error:"The moderation queue could not be loaded."});
  }
};
exports._test={parsePage,sanitize,getInbox,PAGE_SIZE};
