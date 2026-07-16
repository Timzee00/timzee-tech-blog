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
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, email, avatar_url")
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(10);
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error searching users:", error);
    return [];
  }
}
