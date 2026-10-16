const { test, expect } = require('@playwright/test');
const { mockSite, USER_ID } = require('./helpers/fixtures.cjs');

const FRIEND = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const thread = [USER_ID,FRIEND].sort().join('_');
const respond = (route, data) => route.fulfill({
  status:200, contentType:'application/json',
  headers:{'access-control-allow-origin':'*'},
  body:JSON.stringify(data)
});

async function ownChat(page, older=false) {
  await mockSite(page,{role:'user'});
  let message={
    id:MESSAGE_ID,thread_id:thread,sender_id:USER_ID,recipient_id:FRIEND,
    body:'Original message',media_url:null,created_at:new Date(Date.now()-(older?20:2)*60000).toISOString().slice(0,-1),
    edited_at:null,edit_count:0
  };
  const edits=[];
  await page.route('https://*/rest/v1/rpc/can_edit_chat_message',route=>respond(route,!older));
  await page.route('https://*/rest/v1/rpc/edit_chat_message',async route=>{
    const payload=route.request().postDataJSON();
    edits.push(payload);
    if(payload.p_message_id!==message.id||payload.p_expected_body!==message.body){
      return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Message changed on another device'})});
    }
    message={...message,body:payload.p_new_body,edited_at:new Date().toISOString(),edit_count:message.edit_count+1};
    return respond(route,message);
  });
  await page.route('https://*/rest/v1/**',route=>{
    const url=new URL(route.request().url()),table=url.pathname.split('/').pop();
    if(table==='friendships')return respond(route,[{id:'friend',requester_id:USER_ID,addressee_id:FRIEND,status:'accepted'}]);
    if(table==='public_profiles')return respond(route,[{id:FRIEND,display_name:'Ada Reader'}]);
    if(table==='direct_messages')return respond(route,[message]);
    return route.fallback();
  });
  await page.goto('/chat.html?user='+FRIEND);
  await expect(page.locator('.chat-message.self')).toHaveCount(1);
  return {edits,getMessage:()=>message};
}

test('editing own recent text preserves draft, shows Edited, and submits expected version',async({page})=>{
  const {edits}=await ownChat(page);
  await page.locator('#chatBody').fill('My unsent draft stays here');
  await page.getByRole('button',{name:'Message actions',exact:true}).click();
  const menu=page.getByRole('menu',{name:'Message actions'});
  await expect(menu.getByRole('menuitem',{name:'Edit message'})).toBeVisible();
  await menu.getByRole('menuitem',{name:'Edit message'}).click();
  await expect(page.locator('#chatEditPanel')).toBeVisible();
  await expect(page.locator('#chatEditBody')).toHaveValue('Original message');
  await expect(page.locator('#chatBody')).toHaveValue('My unsent draft stays here');
  await page.locator('#chatEditBody').fill('Corrected message');
  await page.getByRole('button',{name:'Save edit'}).click();
  await expect(page.locator('.chat-message.self')).toContainText('Corrected message');
  await expect(page.locator('.chat-edited-indicator')).toHaveText('Edited');
  await expect(page.locator('#chatEditPanel')).toBeHidden();
  await expect(page.locator('#chatBody')).toHaveValue('My unsent draft stays here');
  expect(edits).toEqual([{p_message_id:MESSAGE_ID,p_new_body:'Corrected message',p_expected_body:'Original message'}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('editing can be cancelled without overwriting a draft',async({page})=>{
  const {edits}=await ownChat(page);
  await page.locator('#chatBody').fill('Keep this draft');
  await page.getByRole('button',{name:'Message actions',exact:true}).click();
  await page.getByRole('menuitem',{name:'Edit message'}).click();
  await page.locator('#chatEditBody').fill('Discarded correction');
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click();
  await expect(page.locator('#chatEditPanel')).toBeHidden();
  await expect(page.locator('#chatBody')).toHaveValue('Keep this draft');
  await expect(page.locator('.chat-message.self')).toContainText('Original message');
  expect(edits).toHaveLength(0);
});

test('expired messages hide Edit as decided by the database',async({page})=>{
  await ownChat(page,true);
  await page.getByRole('button',{name:'Message actions',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'Edit message'})).toBeHidden();
});
