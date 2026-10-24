const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {validateEndpoint,validateSubscription,encryptPayload,makeVapidAuth,sendPush}=require("../netlify/functions/_lib/web-push.cjs");
const client=crypto.createECDH("prime256v1");
const ua=client.generateKeys();
const auth=crypto.randomBytes(16);
const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/unit-test-token",keys:{p256dh:ua.toString("base64url"),auth:auth.toString("base64url")}};
const pair=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const jwk=pair.publicKey.export({format:"jwk"});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,"base64url"),Buffer.from(jwk.y,"base64url")]).toString("base64url");
const privateKey=pair.privateKey.export({format:"der",type:"pkcs8"}).toString("base64url");
const config={publicKey,privateKey,subject:"mailto:alerts@example.org"};
test("web push endpoint allowlist rejects SSRF and untrusted providers",()=>{
 for(const url of ["http://fcm.googleapis.com/fcm/send/x","https://127.0.0.1/evil","https://example.com/steal","https://fcm.googleapis.com.evil.org/x","https://user@fcm.googleapis.com/x"]){
  assert.throws(()=>validateEndpoint(url));
 }
 assert.equal(validateSubscription(subscription).keys.auth,subscription.keys.auth);
 assert.throws(()=>validateSubscription({...subscription,keys:{...subscription.keys,auth:"wrong"}}));
});
test("encrypted payload round-trips with client P-256 private key",()=>{
 const plaintext=JSON.stringify({title:"Timzee activity",url:"/notifications.html"});
 const record=encryptPayload(subscription,plaintext);
 assert.equal(record.readUInt32BE(16),4096);
 assert.equal(record[20],65);
 const serverKey=record.subarray(21,86);
 const secret=client.computeSecret(serverKey);
 const ikm=Buffer.from(crypto.hkdfSync("sha256",secret,auth,Buffer.concat([Buffer.from("WebPush: info\0"),ua,serverKey]),32));
 const key=Buffer.from(crypto.hkdfSync("sha256",ikm,record.subarray(0,16),Buffer.from("Content-Encoding: aes128gcm\0"),16));
 const nonce=Buffer.from(crypto.hkdfSync("sha256",ikm,record.subarray(0,16),Buffer.from("Content-Encoding: nonce\0"),12));
 const ciphertext=record.subarray(86);
 const decipher=crypto.createDecipheriv("aes-128-gcm",key,nonce);
 decipher.setAuthTag(ciphertext.subarray(-16));
 const clear=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);
 assert.equal(clear.at(-1),2);
 assert.equal(clear.subarray(0,-1).toString("utf8"),plaintext);
});
test("VAPID ES256 signature is valid for the endpoint origin",()=>{
 const header=makeVapidAuth(subscription.endpoint,publicKey,privateKey,config.subject);
 const [,jwt]=header.match(/vapid t=([^,]+), k=/)||[];
 assert.ok(jwt);
 const parts=jwt.split(".");
 const payload=JSON.parse(Buffer.from(parts[1],"base64url").toString());
 assert.equal(payload.aud,"https://fcm.googleapis.com");
 assert.equal(payload.sub,config.subject);
 assert.ok(crypto.verify("sha256",Buffer.from(parts[0]+"."+parts[1]),{key:pair.publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(parts[2],"base64url")));
});
test("push sends only to approved HTTPS provider, not arbitrary host",async()=>{
 let requested;
 const result=await sendPush(subscription,{title:"Account update",url:"/settings.html"},config,{
  fetchImpl:async (url,opts)=>{requested={url,opts};return {ok:true,status:201};}
 });
 assert.deepEqual(result,{success:true,status:201,permanent:false});
 assert.equal(requested.url,subscription.endpoint);
 assert.match(requested.opts.headers.Authorization,/^vapid t=/);
 assert.equal(requested.opts.headers["Content-Encoding"],"aes128gcm");
});
