const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function runThemeInit(storage, systemDark=true){
  const listeners={};
  const documentListeners={};
  const document={
    readyState:"loading",
    documentElement:{dataset:{},style:{}},
    querySelectorAll:()=>[],
    addEventListener:(name,fn)=>{documentListeners[name]=fn;},
    getElementById:()=>null,
    querySelector:()=>null
  };
  const window={
    matchMedia:()=>({matches:systemDark,addEventListener(){}}),
    addEventListener:(name,fn)=>{(listeners[name] ||= []).push(fn);}
  };
  const localStorage={
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  const context={document,window,localStorage,navigator:{},CustomEvent:function(type,init){this.type=type;this.detail=init.detail;},console,Date,URL,AbortController,setTimeout,clearTimeout};
  vm.runInNewContext(read("assets/js/theme-init.js"),context,{timeout:2000});
  return {document,window,storage,listeners,documentListeners};
}

test("header theme toggle persists to both theme stores and survives a new page",()=>{
  const storage=new Map([
    ["timzee-theme","light"],
    ["timzee-ui-appearance",JSON.stringify({theme:"system",reduceMotion:true})]
  ]);
  const first=runThemeInit(storage,true);
  assert.equal(first.document.documentElement.dataset.theme,"light");
  first.window.appUI.toggleTheme();
  assert.equal(storage.get("timzee-theme"),"dark");
  assert.equal(JSON.parse(storage.get("timzee-ui-appearance")).theme,"dark");
  const nextPage=runThemeInit(storage,false);
  assert.equal(nextPage.document.documentElement.dataset.theme,"dark");
});

test("stale system preference events cannot override a deliberate header choice",()=>{
  const storage=new Map([
    ["timzee-theme","light"],
    ["timzee-ui-appearance",JSON.stringify({theme:"system"})]
  ]);
  const page=runThemeInit(storage,true);
  const staleEvent={detail:{appearance:{theme:"system",highContrast:false}},appearanceThemeExplicit:false};
  for(const listener of page.listeners["timzee:preferences"]||[])listener(staleEvent);
  assert.equal(storage.get("timzee-theme"),"light");
  assert.equal(page.document.documentElement.dataset.theme,"light");

  const deliberateSystemChoice={detail:{appearance:{theme:"system"}},appearanceThemeExplicit:true};
  for(const listener of page.listeners["timzee:preferences"]||[])listener(deliberateSystemChoice);
  assert.equal(storage.has("timzee-theme"),false);
  assert.equal(page.document.documentElement.dataset.theme,"dark");
});

test("only a deliberate appearance.theme save is marked authoritative",()=>{
  const prefs=read("assets/js/user-preferences.js");
  assert.match(prefs,/appearanceThemeExplicit = false/);
  assert.match(prefs,/event\.appearanceThemeExplicit = appearanceThemeExplicit/);
  assert.match(prefs,/Object\.prototype\.hasOwnProperty\.call\(partial\.appearance, "theme"\)/);
});
