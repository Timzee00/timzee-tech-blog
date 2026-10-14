const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");

const moduleSource=readFileSync("assets/js/member-recovery-invite.js","utf8")
  .replace("export async function maybeInviteReturningMember","async function maybeInviteReturningMember");
function setup({optedIn=false,path="/index.html"}={}){
  const requests=[],store=new Map(),elements=[];
  const createElement=tag=>{
    const el={tag,children:[],handlers:{},textContent:"",disabled:false,removed:false,
      append(...nodes){this.children.push(...nodes)},
      prepend(...nodes){this.children.unshift(...nodes)},
      setAttribute(){},
      addEventListener(type,callback){this.handlers[type]=callback},
      remove(){this.removed=true}
    };
    elements.push(el);return el;
  };
  const main={children:[],prepend(...children){this.children.unshift(...children)}};
  const document={visibilityState:"visible",head:{append(){}},
    getElementById:()=>null,createElement,
    querySelector:selector=>selector==="main"?main:null};
  const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)};
  const supabase={
    from(table){requests.push("select:"+table);return{
      select(){return this},eq(){return this},
      async maybeSingle(){return{data:optedIn?{inactivity_reminders:true}:null,error:null}}
    }},
    async rpc(name){requests.push("rpc:"+name);return{data:true,error:null}}
  };
  const fn=new Function("document","localStorage","location",moduleSource+"\nreturn maybeInviteReturningMember;")(
    document,storage,{pathname:path});
  return {fn,requests,store,main,supabase};
}
const existing={id:"11111111-1111-4111-8111-111111111111",created_at:"2025-01-01T00:00:00Z"};
const fresh={id:"22222222-2222-4222-8222-222222222222",created_at:new Date().toISOString()};
test("older members are invited, but no email or preference update occurs automatically",async()=>{
  const env=setup();
  await env.fn({user:existing,supabase:env.supabase});
  assert.equal(env.main.children.length,1);
  assert.deepEqual(env.requests,["select:email_notification_preferences"]);
});
test("new members and already opted-in members are not prompted",async()=>{
  const a=setup(),b=setup({optedIn:true});
  await a.fn({user:fresh,supabase:a.supabase});
  await b.fn({user:existing,supabase:b.supabase});
  assert.equal(a.main.children.length,0);
  assert.equal(b.main.children.length,0);
});
test("explicit button calls only the account-owned opt-in RPC",async()=>{
  const env=setup();
  await env.fn({user:existing,supabase:env.supabase});
  const actions=env.main.children[0].children[1].children;
  const button=actions.find(x=>x.textContent==="Enable check-ins");
  assert.ok(button);
  await button.handlers.click();
  assert.deepEqual(env.requests,["select:email_notification_preferences","rpc:enable_my_inactivity_reminders"]);
  assert.equal(button.textContent,"Enabled");
});
test("not now and don't show again remember user choice without sending",async()=>{
  for(const [action,expected] of [["Not now","until"],["Hide on this device","never"]]){
    const env=setup();
    await env.fn({user:existing,supabase:env.supabase});
    const btn=env.main.children[0].children[1].children.find(x=>x.textContent===action);
    btn.handlers.click();
    const record=JSON.parse(env.store.get("timzee-member-email-invite-v1:"+existing.id));
    assert.ok(record[expected]);
    assert.equal(env.requests.some(x=>x.startsWith("rpc:")),false);
  }
});
test("historic consent remains opt-in and server-side auditable",()=>{
  const sql=readFileSync("supabase/migrations/20261014253000_existing_member_consent_audit.sql","utf8");
  assert.match(sql,/private.email_preference_audit/);
  assert.match(sql,/auth\.uid\(\)/);
  assert.match(sql,/inactivity_opted_in_at=now\(\)/);
  assert.match(sql,/new.inactivity_opted_in_at=old.inactivity_opted_in_at/);
  assert.match(sql,/grant execute on function public.enable_my_inactivity_reminders\(\) to authenticated/);
  assert.doesNotMatch(sql,/insert into private.email_jobs/);
});
