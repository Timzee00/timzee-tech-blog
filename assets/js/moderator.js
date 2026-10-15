/**
 * Moderator Management System
 * Handles promotion/demotion of moderators by super admin
 * Manages author role assignments
 */

import { supabase } from "./supabase.js";

// Get all moderators
export async function getAllModerators() {
  try {
    const { data, error } = await supabase
      .from("moderators")
      .select("*")
      .order("promoted_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching moderators:", error);
    throw error;
  }
}

// Get all authors
export async function getAllAuthors() {
  try {
    const { data, error } = await supabase
      .from("authors")
      .select("*")
      .order("promoted_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching authors:", error);
    throw error;
  }
}

// Promote user to moderator
export async function promoteToModerator(userId, userData) {
  try {
    const { data, error } = await supabase
      .from("moderators")
      .insert({
        user_id: userId,
        username: userData.username,
        full_name: userData.full_name,
        email: userData.email,
        notes: userData.notes || ""
      });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error promoting moderator:", error);
    throw error;
  }
}

// Demote moderator
export async function demoteModerator(moderatorUserId) {
  try {
    const { error } = await supabase
      .from("moderators")
      .delete()
      .eq("user_id", moderatorUserId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error demoting moderator:", error);
    throw error;
  }
}

// Toggle moderator active status
export async function toggleModeratorStatus(moderatorUserId, isActive) {
  try {
    const { data, error } = await supabase
      .from("moderators")
      .update({ is_active: isActive })
      .eq("user_id", moderatorUserId);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error toggling moderator status:", error);
    throw error;
  }
}

// Promote user to author
export async function promoteToAuthor(userId, userData) {
  try {
    const { data, error } = await supabase
      .from("authors")
      .insert({
        user_id: userId,
        username: userData.username,
        full_name: userData.full_name,
        email: userData.email,
        bio: userData.bio || "",
        avatar_url: userData.avatar_url || "",
        notes: userData.notes || ""
      });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error promoting author:", error);
    throw error;
  }
}

// Demote author
export async function demoteAuthor(authorUserId) {
  try {
    const { error } = await supabase
      .from("authors")
      .delete()
      .eq("user_id", authorUserId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error demoting author:", error);
    throw error;
  }
}

// Toggle author active status
export async function toggleAuthorStatus(authorUserId, isActive) {
  try {
    const { data, error } = await supabase
      .from("authors")
      .update({ is_active: isActive })
      .eq("user_id", authorUserId);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error toggling author status:", error);
    throw error;
  }
}

// Get moderator permissions
export async function getModeratorPermissions(moderatorUserId) {
  try {
    const { data, error } = await supabase
      .from("moderators")
      .select("permissions")
      .eq("user_id", moderatorUserId)
      .single();
    if (error) throw error;
    return data?.permissions || [];
  } catch (error) {
    console.error("Error fetching permissions:", error);
    return [];
  }
}

// Update moderator permissions
export async function updateModeratorPermissions(moderatorUserId, permissions) {
  try {
    const { data, error } = await supabase
      .from("moderators")
      .update({ permissions })
      .eq("user_id", moderatorUserId);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating permissions:", error);
    throw error;
  }
}

// Get user profile for promotion
export async function getUserForPromotion(userId) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, email, avatar_url")
      .eq("id", userId)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error fetching user:", error);
    throw error;
  }
}

// Search users for promotion
export async function searchUsersForPromotion(query) {
  const search=String(query||"").trim();
  if(search.length<2)return [];
  try {
    const {data:session}=await supabase.auth.getSession();
    const token=session?.session?.access_token;
    if(!token)return [];
    const response=await fetch("/.netlify/functions/search-staff-users?"+
      new URLSearchParams({search,page:"1"}),{headers:{Authorization:"Bearer "+token},cache:"no-store"});
    const body=await response.json();
    if(!response.ok)throw Error(body.error||"User lookup unavailable");
    return (body.users||[]).map(user=>({
      id:user.id,display_name:user.display_name||"",username:user.username||"",
      email:user.email||"",avatar_url:user.avatar_url||""
    }));
  } catch(error) {
    console.warn("Staff user lookup failed:",error);
    return [];
  }
}
