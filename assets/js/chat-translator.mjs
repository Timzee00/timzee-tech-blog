import {supabase} from "./supabase.js";
export async function translateVerifiedText(text,target="en"){
 const {data,error}=await supabase.auth.getSession();
 if(error||!data.session?.access_token)throw Error("Please sign in again to translate.");
 const request=await fetch("/.netlify/functions/verified-translate",{
   method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+data.session.access_token},
   body:JSON.stringify({text:String(text).slice(0,3000),target})
 });
 const body=await request.json().catch(()=>({}));
 if(!request.ok)throw Error(body.error||"Translation temporarily unavailable");
 return body.translation||"";
}
