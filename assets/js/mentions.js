/**
 * Mentions & Autocomplete System
 * Provides @ mention functionality with real-time user search
 */

import { supabase } from "./supabase.js";
import { escapeHTML, isSafeUrl } from "./utils.js";

let mentionCache = {};
let activeMentionDropdown = null;
let activeMentionField = null;
let currentSearchTerm = "";
let cursorAtMention = false;
let mentionRequest = 0;

/**
 * Search for users to mention
 */
export async function searchUsersForMention(query) {
  if (query.length > 32 || !/^[a-z0-9_]*$/i.test(query)) return [];
  const {data:sessionInfo}=await supabase.auth.getSession();
  const id=sessionInfo?.session?.user?.id||"guest";
  const cacheKey=id+":"+query.toLowerCase();
  if(mentionCache[cacheKey] && Date.now()-mentionCache[cacheKey].time<30000)
    return mentionCache[cacheKey].results;
  try{
    let friends=[];
    if(id!=="guest"){
      const pairs=await supabase.from("friendships").select("requester_id,addressee_id")
        .eq("status","accepted")
        .or("requester_id.eq."+id+",addressee_id.eq."+id).limit(250);
      friends=(pairs.data||[]).map(pair=>pair.requester_id===id?pair.addressee_id:pair.requester_id);
    }
    let preferred=[];
    if(friends.length){
      let request=supabase.from("public_profiles")
        .select("id,username,display_name,avatar_url").in("id",friends.slice(0,250)).limit(12);
      if(query)request=request.or("username.ilike."+query+"%,display_name.ilike."+query+"%");
      const result=await request;
      preferred=result.data||[];
    }
    // If a member does not have matching friends, still find other people.
    let publicRequest=supabase.from("public_profiles")
      .select("id,username,display_name,avatar_url")
      .limit(12);
    if(query)publicRequest=publicRequest.or("username.ilike."+query+"%,display_name.ilike."+query+"%");
    else publicRequest=publicRequest.order("username",{ascending:true});
    const {data,error}=await publicRequest;
    if(error)throw error;
    const seen=new Set();
    const results=[...preferred,...(data||[])].filter(user=>{
      if(!user.id||!user.username||seen.has(user.id))return false;
      seen.add(user.id);return true;
    }).slice(0,10).map(user=>({
      id:user.id,username:user.username,display_name:user.display_name,
      avatar_url:user.avatar_url,is_friend:friends.includes(user.id)
    }));
    mentionCache[cacheKey]={time:Date.now(),results};
    return results;
  }catch(error){console.warn("Mention search unavailable",error);return [];}
}

/**
 * Close the mention dropdown
 */
export function closeMentionDropdown() {
  if (activeMentionDropdown) {
    activeMentionDropdown.remove();
    activeMentionDropdown = null;
  }
  currentSearchTerm = "";
  activeMentionField = null;
  mentionRequest++;
}

/**
 * Show mention suggestions dropdown
 */
async function showMentionDropdown(field, searchTerm) {
  // Remove existing dropdown
  closeMentionDropdown();
  const request = ++mentionRequest;
  const suggestions = await searchUsersForMention(searchTerm);
  if (request !== mentionRequest || !field.isConnected || document.activeElement !== field) return;

  const rect = field.getBoundingClientRect();
  // Android's virtual keyboard reduces visualViewport, not always innerHeight.
  const viewport=window.visualViewport;
  const viewTop=viewport?.offsetTop || 0;
  const viewBottom=viewTop+(viewport?.height || window.innerHeight);
  const menuHeight=Math.min(260,Math.max(100,viewBottom-viewTop-20));
  const roomBelow=viewBottom-rect.bottom;
  const top=roomBelow>=160 ? rect.bottom+5 : Math.max(viewTop+8,rect.top-menuHeight-6);
  const dropdown = document.createElement("div");
  dropdown.className = "mention-dropdown";
  dropdown.setAttribute("role","listbox");
  dropdown.setAttribute("aria-label","Mention a community member");
  dropdown.style.cssText = `
    position: fixed;
    top: ${Math.min(top,viewBottom-70)}px;
    left: ${Math.max(8,Math.min(rect.left,innerWidth-Math.min(300,innerWidth-16)-8))}px;
    width: min(300px, calc(100vw - 16px));
    background: var(--color-surface, #ffffff);
    color: var(--color-text, #111827);
    border: 1px solid #ddd;
    border-radius: 8px;
    max-width: 300px;
    max-height: ${menuHeight}px;
    overflow-y: auto;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  `;

  if(!suggestions.length){
    const empty=document.createElement("p");
    empty.textContent=searchTerm?"No matching community members.":"No members available to mention.";
    empty.style.cssText="margin:0;padding:14px;color:var(--color-text-muted,#64748b);font-size:13px;";
    dropdown.appendChild(empty);
  }
  suggestions.forEach((user) => {
    const item = document.createElement("div");
    item.className = "mention-item";
    item.style.cssText = `
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #f0f0f0;
      transition: background 0.2s;
    `;
    
    const img = document.createElement("img");
    const avatar = isSafeUrl(user.avatar_url) ? user.avatar_url : "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjZTJlOGYwIi8+PC9zdmc+";
    img.src = avatar;
    img.alt = String(user.display_name || user.username || "Member");
    img.className = "avatar avatar--xs";
    img.style.cssText = "border-radius: 50%; object-fit: cover;";

    const copy = document.createElement("div");
    copy.style.cssText = "flex: 1; min-width: 0;";
    const name = document.createElement("div");
    name.style.cssText = "font-weight: 600; font-size: 13px;";
    name.textContent = String(user.display_name || user.username || "Member");
    const handle = document.createElement("div");
    handle.style.cssText = "font-size: 12px; color: #999;";
    handle.textContent = `@${user.username || ""}`;
    copy.append(name, handle);
    if(user.is_friend){
      const badge=document.createElement("small");badge.textContent="Friend";
      badge.style.cssText="color:var(--color-primary,#0f766e);font-weight:700";
      copy.append(badge);
    }
    item.append(img, copy);

    item.addEventListener("mouseover", () => {
      item.style.background = "var(--color-surface-muted,#e5e7eb)";
    });
    item.addEventListener("mouseout", () => {
      item.style.background = "transparent";
    });

    item.setAttribute("role","option");
    item.setAttribute("aria-label",`Mention @${user.username}`);
    // Keep the textarea focused so its caret position is preserved.
    item.addEventListener("pointerdown",event=>event.preventDefault());
    item.addEventListener("click", () => {
      insertMention(field, user.username, searchTerm);
      closeMentionDropdown();
    });

    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);
  activeMentionDropdown = dropdown;
  activeMentionField = field;
}

/**
 * Insert mention into field
 */
export function insertMention(field, username, searchTerm) {
  const text = field.value;
  const cursorPos = field.selectionStart;
  
  // Only replace the mention token immediately before the caret. Never
  // overwrite an unrelated earlier @ mention or an email address.
  const prefix=text.slice(0,cursorPos);
  const match=prefix.match(/(^|[^\w@])@([a-z0-9_]*)$/i);
  if (!match) return;
  const atIndex=cursorPos-match[2].length-1;

  // Replace the @ with mention
  const before = text.substring(0, atIndex);
  const after = text.substring(cursorPos);
  const mention = `@${username}`;
  
  field.value = `${before}${mention} ${after}`;
  
  // Set cursor position after mention
  const newCursorPos = atIndex + mention.length + 1;
  field.selectionStart = newCursorPos;
  field.selectionEnd = newCursorPos;
  
  field.focus();
  closeMentionDropdown();
  
  // Trigger input event for any listeners
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Handle text input for mention detection
 */
export async function handleMentionInput(event) {
  const field = event.target;
  const text = field.value;
  const cursorPos = field.selectionStart;

  // Check if @ is at cursor
  if (cursorPos > 0 && text[cursorPos - 1] === "@") {
    currentSearchTerm = "";
    await showMentionDropdown(field, "");
    return;
  }

  // Check for @ symbol before cursor
  const beforeCursor = text.substring(0, cursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf("@");

  if (lastAtIndex === -1) {
    closeMentionDropdown();
    return;
  }

  // Check if @ is at word boundary
  if (lastAtIndex > 0 && /\w/.test(text[lastAtIndex - 1])) {
    closeMentionDropdown();
    return;
  }

  // Get the search term
  const searchTerm = beforeCursor.substring(lastAtIndex + 1);
  
  // Only show dropdown if we have at least one character after @
  if (searchTerm.length === 0) {
    await showMentionDropdown(field, "");
  } else if (/^\w+$/.test(searchTerm)) {
    // Only alphanumeric characters
    currentSearchTerm = searchTerm;
    await showMentionDropdown(field, searchTerm);
  } else {
    closeMentionDropdown();
  }
}

/**
 * Setup mention system on a textarea or input
 */
export function setupMentionInput(field) {
  if (!field || field.dataset.timzeeMentionsWired === "true") return;
  field.dataset.timzeeMentionsWired = "true";
  field.setAttribute("aria-autocomplete","list");
  field.addEventListener("input", handleMentionInput);
  field.addEventListener("click",()=>{
    if(field.value.slice(0,field.selectionStart).includes("@")) void handleMentionInput({target:field});
  });
  field.addEventListener("keydown", (event) => {
    // Close dropdown on Escape
    if (event.key === "Escape") {
      closeMentionDropdown();
    }
    
    // Handle arrow keys in dropdown
    if (activeMentionDropdown && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const items = activeMentionDropdown.querySelectorAll(".mention-item");
      if (items.length === 0) return;
      
      // Simple cycling through items
      let selected = activeMentionDropdown.querySelector("[data-selected]");
      const current=Array.from(items).indexOf(selected);
      items.forEach(item=>{item.removeAttribute("data-selected");item.style.background="transparent";});
      const next=(current+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;
      items[next].setAttribute("data-selected","true");
      items[next].style.background="var(--color-surface-muted, #e5e7eb)";
      items[next].scrollIntoView({block:"nearest"});

    }

    // Handle Enter to select mention
    if (activeMentionDropdown && event.key === "Enter") {
      event.preventDefault();
      const selected = activeMentionDropdown.querySelector("[data-selected]");
      if (selected) {
        selected.click();
      } else {
        const first = activeMentionDropdown.querySelector(".mention-item");
        if (first) first.click();
      }
    }
  });

  // Close dropdown on blur
  field.addEventListener("blur", () => {
    setTimeout(closeMentionDropdown, 100);
  });
}

/**
 * Extract all mentions from text
 */
export function extractMentions(text) {
  if (!text) return [];
  const regex = /@([a-zA-Z0-9_]+)/g;
  const mentions = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return [...new Set(mentions)]; // Remove duplicates
}

/**
 * Convert mention text to links
 */
export function linkifyMentions(text) {
  if (!text) return text;
  return text.replace(/@([a-zA-Z0-9_]+)/g, (match, username) => {
    return `<a href="profile.html?username=${encodeURIComponent(username)}" class="mention-link">@${username}</a>`;
  });
}

/**
 * Get mentioned user IDs from text
 */
export async function getMentionedUserIds(text) {
  const mentions = extractMentions(text);
  if (mentions.length === 0) return [];

  try {
    const { data } = await supabase
      .from("public_profiles")
      .select("id")
      .in("username", mentions);

    return data ? data.map(u => u.id) : [];
  } catch (error) {
    console.error("Failed to get mentioned user IDs:", error);
    return [];
  }
}

export default {
  setupMentionInput,
  extractMentions,
  linkifyMentions,
  getMentionedUserIds,
  searchUsersForMention,
  closeMentionDropdown,
  insertMention,
  handleMentionInput
};
