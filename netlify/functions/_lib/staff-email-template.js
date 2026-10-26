"use strict";
// Blipmood: source-safe branded transactional message composition.
// Influenced by the server-only brandedEmail pattern in Timzee Corp.
const escapeHtml=(value)=>String(value??"").replace(/[&<>"']/g,ch=>({
 "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[ch]));
function buildStaffReplyEmail({message,name="there",requestKind="contact"}){
 const recipientName=(String(name||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").trim().slice(0,90))||"there";
 const safeName=escapeHtml(recipientName);
 const kind=String(requestKind||"contact").replace(/[^a-z]/gi,"").slice(0,30);
 const safeMessage=escapeHtml(message);
 const textContent="Hello "+recipientName+",\n\n"+message+"\n\n— Blipmood\n"+
   "This is a reply to your "+kind+" request. Do not share passwords or account security codes.";
 const htmlContent='<!doctype html><html lang="en"><head><meta charset="UTF-8"></head>'+
 '<body style="margin:0;padding:24px 12px;background:#edf4f3;color:#172e31;font-family:Arial,Helvetica,sans-serif">'+
 '<table role="presentation" style="border-collapse:collapse;max-width:640px;width:100%;margin:0 auto;background:#fff;border:1px solid #cddcda;border-radius:16px">'+
 '<tr><td style="padding:24px;background:#113b3a;color:#fff;border-radius:16px 16px 0 0"><div style="font-weight:700;font-size:21px"><img src="https://timzee-tech-blog.netlify.app/assets/brand/blipmood-mark.svg" width="44" height="44" alt="" style="vertical-align:middle;width:44px;height:44px;margin-right:7px">Blipmood</div>'+
 '<div style="font-size:12px;margin-top:7px">TEAM SUPPORT &amp; COMMUNITY</div></td></tr>'+
 '<tr><td style="padding:30px 25px"><h1 style="font-size:21px;line-height:1.4;margin:0 0 18px">A reply from our team</h1>'+
 '<p style="font-size:15px;line-height:1.7">Hello '+safeName+',</p>'+
 '<div style="font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere">'+safeMessage+'</div></td></tr>'+
 '<tr><td style="padding:18px 25px;background:#f6faf9;border-radius:0 0 16px 16px;font-size:12px;line-height:1.7;color:#53696b">'+
 'This is an official reply regarding your '+escapeHtml(kind)+' request. Never send passwords, login codes or other sensitive credentials by email.</td></tr></table></body></html>';
 return {htmlContent,textContent};
}
module.exports={buildStaffReplyEmail,escapeHtml};