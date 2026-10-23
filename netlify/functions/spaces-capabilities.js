// Only reveal whether audio credentials appear configured.
// Connectivity and account quotas require separate live verification.
function audioConfigured(env=process.env){
 try{
  const u=new URL(String(env.LIVEKIT_URL||""));
  return u.protocol==="wss:"&&u.pathname==="/"&&!u.username&&!u.password&&Boolean(u.hostname)
    &&Boolean(String(env.LIVEKIT_API_KEY||"").trim())
    &&Boolean(String(env.LIVEKIT_API_SECRET||"").trim());
 }catch{return false}
}
exports.handler=async event=>{
 if(event.httpMethod!=="GET")return {statusCode:405,
  headers:{"Allow":"GET","Content-Type":"application/json","Cache-Control":"no-store"},
  body:JSON.stringify({error:"GET required."})};
 return {statusCode:200,headers:{"Content-Type":"application/json",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
  body:JSON.stringify({audioConfigured:audioConfigured()})};
};
exports._test={audioConfigured};
