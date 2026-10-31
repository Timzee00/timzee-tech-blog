const list=document.getElementById("bewList");
const status=document.getElementById("bewStatus");
const channel=document.getElementById("bewChannel");
async function loadWinners(){
 const response=await fetch("/.netlify/functions/blip-earn?view=winners",{cache:"no-store"});
 if(!response.ok)throw Error("Verified winner announcements are temporarily unavailable.");
 const payload=await response.json();
 const winners=Array.isArray(payload.winners)?payload.winners:[];
 list.replaceChildren();
 if(!winners.length){
   status.textContent="No public winners yet. Award recipients are listed only after payment and voluntary publication consent.";
   list.hidden=true;
 }else{
   status.textContent=winners.length+" confirmed winner"+(winners.length===1?"":"s")+
    " listed with publication permission.";
   for(const entry of winners.slice(0,30)){
     if(typeof entry.username!=="string"||!/^[A-Za-z0-9_]{3,32}$/.test(entry.username))continue;
     const card=document.createElement("article");card.className="bew-card";
     const title=document.createElement("h2");title.textContent="@"+entry.username;
     const amount=document.createElement("div");amount.className="bew-amount";
     amount.textContent="₦"+Number(entry.amount_naira||1000).toLocaleString();
     const description=document.createElement("p");
     description.textContent="Referral milestone "+Number(entry.milestone||1)+" · Personally paid and confirmed";
     card.append(title,amount,description);list.append(card);
   }
   list.hidden=list.children.length===0;
 }
 const url=typeof payload.channel_url==="string"?payload.channel_url:"";
 if(/^https:\/\/[^\s]+$/i.test(url)){
   const a=document.createElement("a");a.href=url;a.className="bew-link";
   a.rel="noopener noreferrer";a.target="_blank";a.textContent="Visit Blipmood winners announcement channel";
   channel.replaceChildren(a);
 }
}
void loadWinners().catch(error=>{status.textContent=error.message||"Unable to load the winners board.";list.hidden=true;});
