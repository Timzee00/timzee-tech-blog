import { supabase } from "./supabase.js";

export async function getPublishedFaqs() {
  try {
    const { data, error } = await supabase
      .from("faqs")
      .select("*")
      .eq("is_published", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching faqs:", error);
    return [];
  }
}

export async function getAllFaqs() {
  try {
    const { data, error } = await supabase
      .from("faqs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching all faqs:", error);
    return [];
  }
}

export async function createFaq(faq) {
  try {
    const { data, error } = await supabase
      .from("faqs")
      .insert({
        question: faq.question,
        answer: faq.answer,
        category: faq.category || null,
        is_published: !!faq.is_published
      });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error creating faq:", error);
    throw error;
  }
}

export async function updateFaq(id, faq) {
  try {
    const { data, error } = await supabase
      .from("faqs")
      .update({
        question: faq.question,
        answer: faq.answer,
        category: faq.category || null,
        is_published: !!faq.is_published
      })
      .eq("id", id);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating faq:", error);
    throw error;
  }
}

export async function deleteFaq(id) {
  try {
    const { error } = await supabase.from("faqs").delete().eq("id", id);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error deleting faq:", error);
    throw error;
  }
}