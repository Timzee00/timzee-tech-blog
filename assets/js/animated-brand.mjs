// Progressive enhancement for the user-supplied animated brand.
// Keep the approved static PNG readable and visible until all animation layers
// are decoded; no changes to logo links, page structure or footer branding.
const shouldAnimate=()=>{
  if(document.documentElement.dataset.reduceMotion==="true")return false;
  if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)return false;
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(connection?.saveData || /(?:slow-2g|2g)/.test(connection?.effectiveType||""))return false;
  return true;
};

export async function enhanceAnimatedHeader(){
  const wrapper=document.querySelector(".site-header a.brand > .bm-brand-display");
  const fallback=wrapper?.querySelector(".bm-wordmark-image");
  if(!wrapper||!fallback||wrapper.querySelector("blipmood-logo")||!shouldAnimate())return false;

  // The large visual source is cached and loaded only after essential site UI.
  await import("./blipmood-logo.js");
  if(!shouldAnimate()||!wrapper.isConnected)return false;

  const logo=document.createElement("blipmood-logo");
  logo.setAttribute("aria-hidden","true");
  logo.setAttribute("theme",document.documentElement.dataset.theme==="light"?"light":"dark");
  logo.setAttribute("replay","hover");
  logo.setAttribute("speed","1.1");
  wrapper.append(logo);
  const images=[...logo.shadowRoot.querySelectorAll("img[data-k]")];
  try{
    await Promise.all(images.map(img=>img.decode()));
  }catch{
    logo.remove(); // No broken/empty wordmark if an embedded layer fails.
    return false;
  }
  if(!wrapper.isConnected||!shouldAnimate()){logo.remove();return false;}
  wrapper.classList.add("bm-animated-ready");

  const update=()=>{
    if(!wrapper.isConnected)return;
    if(!shouldAnimate()){
      wrapper.classList.remove("bm-animated-ready");
      return;
    }
    const newTheme=document.documentElement.dataset.theme==="light"?"light":"dark";
    if(logo.getAttribute("theme")!==newTheme){
      wrapper.classList.remove("bm-animated-ready");
      logo.setAttribute("theme",newTheme);
      const all=[...logo.shadowRoot.querySelectorAll("img[data-k]")];
      void Promise.all(all.map(img=>img.decode())).then(()=>{
        if(wrapper.isConnected&&shouldAnimate())wrapper.classList.add("bm-animated-ready");
      }).catch(()=>{});
    }else{
      wrapper.classList.add("bm-animated-ready");
    }
  };
  new MutationObserver(update).observe(document.documentElement,{
    attributes:true,attributeFilter:["data-theme","data-reduce-motion"]
  });
  return true;
}
