/**
 * Mentions & Autocomplete System
 * Provides @ mention functionality with real-time user search
 */

import { supabase } from "./supabase.js";

let mentionCache = {};
let activeMentionDropdown = null;
let activeMentionField = null;
let currentSearchTerm = "";
let cursorAtMention = false;

/**
 * Search for users to mention
 */
export async function searchUsersForMention(query) {
  if (!query || query.length < 2) return [];
  
  // Check cache first
  const cacheKey = `mention_${query.toLowerCase()}`;
  if (mentionCache[cacheKey]) {
    return mentionCache[cacheKey];
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .ilike("username", `%${query}%`)
      .limit(10);

    if (error) {
      console.error("User search error:", error);
      return [];
    }

    const results = (data || []).map(user => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url
    }));

    mentionCache[cacheKey] = results;
    return results;
  } catch (error) {
    console.error("Mention search failed:", error);
    return [];
  }
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
}

/**
 * Show mention suggestions dropdown
 */
async function showMentionDropdown(field, searchTerm) {
  // Remove existing dropdown
  closeMentionDropdown();

  const suggestions = await searchUsersForMention(searchTerm);
  if (suggestions.length === 0) return;

  const rect = field.getBoundingClientRect();
  const dropdown = document.createElement("div");
  dropdown.className = "mention-dropdown";
  dropdown.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 5}px;
    left: ${rect.left}px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    max-width: 300px;
    max-height: 300px;
    overflow-y: auto;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  `;

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
    
    item.innerHTML = `
      <img src="${user.avatar_url || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjZTJlOGYwIi8+PC9zdmc+'}" 
           style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; font-size: 13px;">${user.display_name || user.username}</div>
        <div style="font-size: 12px; color: #999;">@${user.username}</div>
      </div>
    `;

    item.addEventListener("mouseover", () => {
      item.style.background = "#f9fafb";
    });
    item.addEventListener("mouseout", () => {
      item.style.background = "transparent";
    });

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
  
  // Find the @ symbol
  let atIndex = text.lastIndexOf("@", cursorPos - 1);
  if (atIndex === -1) atIndex = 0;

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
  if (!field) return;

  field.addEventListener("input", handleMentionInput);
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
      if (!selected && event.key === "ArrowDown") {
        items[0].setAttribute("data-selected", "true");
        items[0].style.background = "#f0f0f0";
      }
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
      .from("profiles")
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
