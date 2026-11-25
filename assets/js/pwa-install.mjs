const installButton=document.getElementById("androidInstallButton");
const installStatus=document.getElementById("installStatus");
const androidHelp=document.getElementById("androidInstallHelp");
let deferredInstallPrompt=null;

const isIos=/iPhone|iPad|iPod/i.test(navigator.userAgent)||
  (navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const isStandalone=window.matchMedia?.("(display-mode: standalone)")?.matches||
  navigator.standalone===true;

function announce(message){
  if(installStatus)installStatus.textContent=message;
}

if(isStandalone){
  announce("Blipmood is already installed on this device.");
  if(installButton)installButton.hidden=true;
}else if(isIos){
  announce("On iPhone or iPad, use Safari's Share menu to add Blipmood to your Home Screen.");
  if(installButton)installButton.hidden=true;
}

window.addEventListener("beforeinstallprompt",event=>{
  // Keep the browser prompt under the visitor's control; never interrupt page load.
  event.preventDefault();
  deferredInstallPrompt=event;
  if(installButton&&!isStandalone&&!isIos){
    installButton.hidden=false;
    installButton.disabled=false;
  }
});

installButton?.addEventListener("click",async()=>{
  if(!deferredInstallPrompt){
    announce("The quick install prompt is unavailable. Open your browser menu and choose Install app or Add to Home screen.");
    return;
  }
  const promptEvent=deferredInstallPrompt;
  deferredInstallPrompt=null;
  installButton.disabled=true;
  try{
    // prompt() is called directly from the visitor's click gesture.
    await promptEvent.prompt();
    const choice=await promptEvent.userChoice;
    if(choice?.outcome==="accepted"){
      announce("Blipmood installation was accepted. Follow your browser's on-screen steps.");
    }else{
      announce("Installation was cancelled. You can still install Blipmood from your browser menu.");
    }
  }catch(error){
    announce("The install prompt could not open. Use your browser menu to install Blipmood instead.");
  }finally{
    installButton.hidden=true;
    installButton.disabled=false;
  }
});

window.addEventListener("appinstalled",()=>{
  deferredInstallPrompt=null;
  if(installButton)installButton.hidden=true;
  announce("Blipmood is installed on this device.");
});

if(!isStandalone&&!isIos&&androidHelp){
  androidHelp.textContent="Open this page in Chrome, tap the browser menu (⋮), then choose Install app or Add to Home screen when available. On supported browsers, an Install Blipmood button will appear here.";
}
