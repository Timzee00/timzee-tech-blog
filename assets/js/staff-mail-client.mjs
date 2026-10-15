// TIMZEE authenticated staff mail transport.
// Mirrors Timzee Corp's separated browser-client/server-mail architecture.
// Never put a Brevo or Supabase service key in the browser.
import {getSession} from "./auth.js";

async function requestStaffMail(path,options={}){
 const session=await getSession();
 if(!session?.access_token)throw Error("Admin session expired. Please sign in again.");
 let response;
 try{
   response=await fetch("/.netlify/functions/admin-reply-email"+path,{
     ...options,cache:"no-store",
     headers:{"accept":"application/json",Authorization:"Bearer "+session.access_token,...options.headers}
   });
 }catch{throw Error("Couldn't reach the email service. Check your connection before trying again.");}
 let data;
 try{data=await response.json();}catch{
   throw Error(response.status===404?
     "The Brevo reply function isn't in this development preview yet. A Netlify rebuild is required.":
     "The email service returned an unreadable response (HTTP "+response.status+").");
 }
 if(!response.ok)throw Error(data?.error||"Mail request failed (HTTP "+response.status+").");
 return data;
}
export async function submitStaffReply({kind,requestId,clientRequestId,subject,message}){
 return requestStaffMail("",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({
     kind,request_id:requestId,client_request_id:clientRequestId,subject,message
   })
 });
}
export async function checkStaffReply(clientRequestId){
 return requestStaffMail("?id="+encodeURIComponent(clientRequestId),{method:"GET"});
}
