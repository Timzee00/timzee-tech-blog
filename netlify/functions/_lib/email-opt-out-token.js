const crypto=require("node:crypto");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function getSecret(){
  const value=process.env.EMAIL_UNSUBSCRIBE_SECRET||"";
  if(value.length<32)throw new Error("Email unsubscribe signing secret not configured");
  return value;
}
function sign(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature=crypto.createHmac("sha256",getSecret()).update(body).digest("base64url");
  return body+"."+signature;
}
function createInactivityToken(job){
  const id=String(job.id||"");
  const user=String(job.payload?.user_id||"");
  if(!UUID.test(id)||!UUID.test(user))throw new Error("Inactivity job missing stable identifiers");
  return sign({v:1,c:"inactivity_reminder",j:id,u:user,
    exp:Math.floor(Date.now()/1000)+90*24*60*60});
}
function verifyInactivityToken(input){
  const token=String(input||"");
  if(token.length>1024||!token.includes("."))return null;
  const parts=token.split(".");
  if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]+$/.test(parts[1]))return null;
  const expected=crypto.createHmac("sha256",getSecret()).update(parts[0]).digest();
  let signature;
  try{signature=Buffer.from(parts[1],"base64url");}catch{return null;}
  if(signature.length!==expected.length||!crypto.timingSafeEqual(signature,expected))return null;
  let value;
  try{value=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));}catch{return null;}
  if(value?.v!==1||value.c!=="inactivity_reminder"||!UUID.test(value.j||"")||!UUID.test(value.u||""))return null;
  const now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(value.exp)||value.exp<=now||value.exp>now+91*24*60*60)return null;
  return {jobId:value.j,userId:value.u};
}
module.exports={createInactivityToken,verifyInactivityToken};
