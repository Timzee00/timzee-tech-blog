// Register the already-existing push-compatible worker after rendering.
// No notification permission is requested here; push stays opt-in.
if ("serviceWorker" in navigator &&
    (location.protocol==="https:" || location.hostname==="localhost" || location.hostname==="127.0.0.1")) {
  const run=()=>{
    const register=()=>void navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"})
      .catch(error=>console.warn("Offline support unavailable:",error?.message||error));
    if ("requestIdleCallback" in window) window.requestIdleCallback(register,{timeout:3000});
    else window.setTimeout(register,750);
  };
  if(document.readyState==="complete")run();
  else window.addEventListener("load",run,{once:true});
}
