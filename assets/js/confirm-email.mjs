import {supabase} from "./supabase.js";

const confirmButton=document.getElementById("confirmEmailButton");
const status=document.getElementById("confirmEmailStatus");
const params=new URLSearchParams(window.location.search);
const tokenHash=params.get("token_hash")||"";
const kind=params.get("type")||"";
let confirming=false;

function feedback(message,failed=false){
 status.textContent=message;
 status.dataset.error=String(failed);
}
// This endpoint is only for new email sign-up confirmation. Never accept
// an arbitrary OAuth redirect, recovery type, or external destination.
if(kind==="email" && /^[A-Za-z0-9_-]{16,512}$/.test(tokenHash)){
 confirmButton.disabled=false;
 feedback("Your confirmation link is ready. Tap the button to verify.");
}else{
 feedback("This confirmation link is incomplete or invalid. Open the latest verification email, or sign in if you already verified.",true);
}

confirmButton.addEventListener("click",async()=>{
 if(confirming||confirmButton.disabled)return;
 confirming=true;confirmButton.disabled=true;
 confirmButton.textContent="Verifying…";
 feedback("Checking your email confirmation securely…");
 // Clear the bearer token from browser history as soon as it is used.
 const clean=new URL(window.location.href);
 clean.searchParams.delete("token_hash");
 clean.searchParams.delete("type");
 history.replaceState({},document.title,clean.pathname+clean.search);
 try{
  const {data,error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:"email"});
  if(error)throw error;
  if(!data?.user?.id||!data?.session?.access_token){
   throw new Error("Your email may be confirmed, but a sign-in session was not returned. Sign in to continue.");
  }
  const verified=await supabase.auth.getUser();
  if(verified.error||verified.data?.user?.id!==data.user.id){
   throw new Error("We could not verify your sign-in. Please sign in to finish setup.");
  }
  feedback("Email confirmed! Opening your profile setup…");
  // welcome.html is the existing source of truth: incomplete users begin
  // setup at step 1; completed users are redirected safely to their next page.
  window.location.replace("/welcome.html");
 }catch(error){
  const message=String(error?.message||"");
  if(/expired|invalid|token|not found|already/i.test(message)){
   feedback("This link has expired or was already used. If your email is confirmed, sign in to finish setting up your profile.",true);
  }else{
   feedback("Verification couldn't be completed: "+(message||"Please try signing in."),true);
  }
  confirmButton.textContent="Open your latest verification email";
  // A consumed or invalid token must not be retried without a fresh email link.
  confirmButton.disabled=true;
 }finally{
  confirming=false;
 }
});
