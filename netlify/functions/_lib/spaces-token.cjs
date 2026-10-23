const {createHmac,randomUUID,timingSafeEqual}=require("node:crypto");
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
function createRoomToken({apiKey,apiSecret,userId,roomId,role,displayName="",now=Date.now()}){
 if(!apiKey||!apiSecret||!UUID.test(String(userId))||!UUID.test(String(roomId))||
    !["host","speaker","listener"].includes(role))throw Error("Invalid Live Spaces token inputs");
 const issue=Math.floor(now/1000);
 const canPublish=role==="host"||role==="speaker";
 const claims={
  iss:apiKey,sub:"u_"+userId,iat:issue,nbf:issue-3,exp:issue+120,jti:randomUUID(),
  name:String(displayName||"Member").slice(0,80),
  video:{room:"space_"+roomId,roomJoin:true,canPublish,canSubscribe:true,
    canPublishData:true,canPublishSources:canPublish?["microphone"]:[]}
 };
 const signingInput=encode({alg:"HS256",typ:"JWT"})+"."+encode(claims);
 const signature=createHmac("sha256",apiSecret).update(signingInput).digest("base64url");
 return signingInput+"."+signature;
}

function createRoomServiceToken({apiKey,apiSecret,roomId,action,now=Date.now()}){
 if(!apiKey||!apiSecret||!UUID.test(String(roomId))||
    !["delete","remove"].includes(action))throw Error("Invalid room management credentials");
 const at=Math.floor(now/1000);
 const claims={iss:apiKey,sub:"spaces-service",iat:at,nbf:at-3,exp:at+60,jti:randomUUID(),
 video:action==="delete"?{roomCreate:true}:{room:"space_"+roomId,roomAdmin:true}};
 const signingInput=encode({alg:"HS256",typ:"JWT"})+"."+encode(claims);
 return signingInput+"."+createHmac("sha256",apiSecret).update(signingInput).digest("base64url");
}
module.exports={createRoomToken,createRoomServiceToken,UUID};
