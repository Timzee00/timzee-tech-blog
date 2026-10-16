// Private, authenticated chat enhancements. Online means recently active in
// the chat page, never merely that the local WebSocket is connected.
export function setupChatEnhancements({supabase, onPresence}) {
  const state={userId:'',friendId:'',threadId:'',timer:null,privacy:{read_receipts:true,show_online:true}};
  const byId=id=>document.getElementById(id);
  const shouldTrack=()=>document.visibilityState==='visible' && navigator.onLine && !!state.userId;
  const formatLastSeen=iso=>{
    const date=new Date(iso);if(!Number.isFinite(date.getTime()))return 'Not active in chat';
    const secs=Math.floor((Date.now()-date.getTime())/1000);
    if(secs<120)return 'Active in chat recently';
    if(secs<3600)return `Last in chat ${Math.floor(secs/60)}m ago`;
    if(secs<86400)return `Last in chat ${Math.floor(secs/3600)}h ago`;
    return 'Last in chat earlier';
  };
  async function updatePresence(){
    if(!state.userId||!state.threadId)return;
    if(!state.friendId){onPresence('Group conversation',false);return;}
    try{
      const target=state.friendId;
      const {data,error}=await supabase.rpc('chat_contact_activity',{p_other:target});
      if(target!==state.friendId||error)return;
      if(!data?.visible){onPresence('Chat available',false);return;}
      if(data.active_in_chat)onPresence('Active in chat',true);
      else onPresence(data.last_active_at?formatLastSeen(data.last_active_at):'Not active in chat',false);
    }catch{/* Network status is not another person's presence. */}
  }
  async function heartbeat(){
    if(!shouldTrack())return;
    try{await supabase.rpc('chat_touch_activity');}catch{/* Activity is optional. */}
  }
  async function refreshPrivacy(){
    if(!state.userId)return;
    const {data,error}=await supabase.from('chat_privacy')
      .select('read_receipts,show_online').eq('user_id',state.userId).maybeSingle();
    if(!error&&data)state.privacy={...state.privacy,...data};
    for(const [id,field] of [['chatReadReceipts','read_receipts'],['chatShowOnline','show_online']]){
      const input=byId(id);if(input)input.checked=state.privacy[field]!==false;
    }
  }
  async function setPrivacy(field,enabled){
    if(!state.userId)return;
    const next={...state.privacy,[field]:enabled};
    const {error}=await supabase.from('chat_privacy').upsert({
      user_id:state.userId,...next,updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if(error)throw error;
    state.privacy=next;
  }
  async function markRead(messageId){
    if(!messageId||!shouldTrack()||state.privacy.read_receipts===false)return;
    const viewport=byId('chatMessages');
    // Scrolling through older messages must not mark unseen new messages read.
    if(viewport&&viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight>120)return;
    try{await supabase.rpc('mark_chat_thread_read',{p_message_id:messageId});}
    catch{/* Receipt delivery must not interrupt chat. */}
  }
  async function messageInfo(messageId){
    const {data,error}=await supabase.rpc('chat_message_info',{p_message_id:messageId});
    if(error)throw error;
    const previous=byId('chatMessageInfoDialog');previous?.remove();
    const dlg=document.createElement('dialog');dlg.id='chatMessageInfoDialog';
    dlg.className='chat-message-info-dialog';
    const heading=document.createElement('h3');heading.textContent='Message info';dlg.append(heading);
    const sent=document.createElement('p');
    sent.textContent=data?.sent_at?'Sent to server: '+new Date(data.sent_at+'Z').toLocaleString():'Sent to server';
    dlg.append(sent);
    if(data?.own_message){
      const list=document.createElement('div');list.className='chat-readers';
      if(data.recipient_receipts_enabled===false){
        list.textContent='This recipient has turned off read receipts.';
      }else if(data.readers?.length){
        for(const reader of data.readers){
          const row=document.createElement('p');
          row.textContent=`Read by ${reader.name||'Member'} · ${new Date(reader.read_at).toLocaleString()}`;
          list.append(row);
        }
      }else list.textContent='Not marked as read. Delivery to the other device cannot be confirmed.';
      dlg.append(list);
    }
    const close=document.createElement('button');close.type='button';close.className='btn';
    close.textContent='Close';close.onclick=()=>dlg.close();dlg.append(close);
    dlg.addEventListener('close',()=>dlg.remove(),{once:true});
    document.body.append(dlg);dlg.showModal();
  }
  function setup(){
    for(const [id,field] of [['chatReadReceipts','read_receipts'],['chatShowOnline','show_online']]){
      const input=byId(id);if(!input)continue;
      input.addEventListener('change',async()=>{
        input.disabled=true;
        try{await setPrivacy(field,input.checked);if(field==='show_online')await updatePresence();}
        catch(e){input.checked=!input.checked;window.siteToast?.('Privacy preference could not be saved. Please try again.',{type:'error'});}
        finally{input.disabled=false;}
      });
    }
    document.addEventListener('visibilitychange',()=>{
      if(shouldTrack()){void heartbeat();void updatePresence();}
      else if(document.visibilityState!=='visible')onPresence('Chat available',false);
    });
    window.addEventListener('online',()=>{void heartbeat();void updatePresence();});
    let scrollTimer;
    byId('chatMessages')?.addEventListener('scroll',()=>{
      clearTimeout(scrollTimer);
      scrollTimer=setTimeout(()=>{
        const messages=[...document.querySelectorAll('#chatMessages .chat-message[data-message-id]')];
        const last=messages.filter(el=>el.dataset.messageSelf!=='true').at(-1);
        if(last?.dataset.messageId)void markRead(last.dataset.messageId);
      },300);
    },{passive:true});
  }
  async function activate(userId,threadId,friendId=''){
    state.userId=userId||'';state.friendId=friendId;state.threadId=threadId;
    clearInterval(state.timer);
    await refreshPrivacy();
    if(state.threadId){void heartbeat();void updatePresence();}
    state.timer=setInterval(()=>{void heartbeat();void updatePresence();},45000);
  }
  function deactivate(){
    clearInterval(state.timer);state.timer=null;
    state.friendId='';state.threadId='';
  }
  return {setup,activate,deactivate,markRead,messageInfo,refreshPrivacy};
}
