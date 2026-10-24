"use strict";
// Standards-based Web Push (RFC 8291 aes128gcm / RFC 8292 VAPID).
// No third-party push gateway or package dependency. Secrets stay server-side.
const crypto = require("node:crypto");
const b64 = value => Buffer.from(value).toString("base64url");
const unb64 = value => Buffer.from(String(value || ""), "base64url");
function validateEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 2048) throw Error("Invalid push endpoint");
  let url;
  try { url = new URL(endpoint); } catch { throw Error("Invalid push endpoint"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw Error("Invalid push endpoint");
  const host = url.hostname.toLowerCase();
  const allowed = host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host === "push.services.mozilla.com" ||
    host === "web.push.apple.com" ||
    (host.endsWith(".push.apple.com") && host !== ".push.apple.com");
  if (!allowed || !url.pathname || url.pathname === "/") throw Error("Unrecognized push provider");
  return url;
}
function validateSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") throw Error("Subscription is required");
  validateEndpoint(subscription.endpoint);
  const ua = unb64(subscription.keys?.p256dh);
  const auth = unb64(subscription.keys?.auth);
  if (ua.length !== 65 || ua[0] !== 4 || auth.length !== 16) throw Error("Malformed push encryption keys");
  return { endpoint: subscription.endpoint, keys: {p256dh:b64(ua),auth:b64(auth)} };
}
function makeVapidAuth(endpoint, publicKey, privateKey, subject, now = Date.now()) {
  const url = validateEndpoint(endpoint);
  const pub = unb64(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw Error("Invalid VAPID public key");
  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject || "")) throw Error("Invalid VAPID subject");
  const key = crypto.createPrivateKey({key:unb64(privateKey),format:"der",type:"pkcs8"});
  const token = [b64(JSON.stringify({typ:"JWT",alg:"ES256"})),
    b64(JSON.stringify({aud:url.origin,exp:Math.floor(now/1000)+12*3600,sub:subject}))].join(".");
  const signature = crypto.sign("sha256",Buffer.from(token),{key,dsaEncoding:"ieee-p1363"});
  return "vapid t=" + token + "." + b64(signature) + ", k=" + b64(pub);
}
function encryptPayload(subscription, payload) {
  const safe = validateSubscription(subscription);
  const userKey = unb64(safe.keys.p256dh);
  const auth = unb64(safe.keys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  const serverKey = ecdh.generateKeys();
  const secret = ecdh.computeSecret(userKey);
  const salt = crypto.randomBytes(16);
  const context = Buffer.concat([Buffer.from("WebPush: info\0"),userKey,serverKey]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256",secret,auth,context,32));
  const key = Buffer.from(crypto.hkdfSync("sha256",ikm,salt,Buffer.from("Content-Encoding: aes128gcm\0"),16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256",ikm,salt,Buffer.from("Content-Encoding: nonce\0"),12));
  const plaintext = Buffer.concat([Buffer.from(String(payload),"utf8"),Buffer.from([2])]);
  if (plaintext.length > 3800) throw Error("Push message is too large");
  const cipher = crypto.createCipheriv("aes-128-gcm",key,nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt,recordSize,Buffer.from([serverKey.length]),serverKey,encrypted]);
}
async function sendPush(subscription, message,config,{fetchImpl=fetch}={}) {
  const safe=validateSubscription(subscription);
  const body=encryptPayload(safe,JSON.stringify(message));
  const response=await fetchImpl(safe.endpoint,{
    method:"POST",
    headers:{"TTL":"3600","Urgency":"normal","Content-Encoding":"aes128gcm",
      "Content-Type":"application/octet-stream",
      "Authorization":makeVapidAuth(safe.endpoint,config.publicKey,config.privateKey,config.subject)},
    body,signal:AbortSignal.timeout(6500),redirect:"error"
  });
  return {success:response.ok,status:response.status,permanent:response.status===404||response.status===410};
}
module.exports={validateEndpoint,validateSubscription,makeVapidAuth,encryptPayload,sendPush};
