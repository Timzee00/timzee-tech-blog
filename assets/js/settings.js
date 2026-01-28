import { supabase } from "./supabase.js";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export const DEFAULT_SETTINGS = {
  siteName: "Timzee Tech Hub",
  tagline: "Forum-inspired tech news, builds, and community experiments.",
  heroTitle: "Build. Discuss. Ship.",
  heroIntro:
    "A forum-inspired tech board with modern storytelling, live reactions, and creator tools for Timzee Tech Hub.",
  rules: "Respect each other, share sources, and keep posts useful. No spam or hate speech.",
  themeAccent: "#0f766e",
  features: {
    commentModeration: true,
    allowImageComments: true
  },
  support: {
    whatsappNumber: "",
    whatsappMessage: "Hi Timzee Tech Hub, I need help."
  },
  donation: {
    enabled: false,
    title: "Support Timzee Tech Hub",
    details: "",
    url: ""
  },
  adSense: {
    enabled: false,
    publisherId: "",
    slots: {
      homeTop: "",
      homeSidebar: "",
      postInline: ""
    }
  },
  themeId: ""
};

function mapRowToSettings(row) {
  if (!row) return DEFAULT_SETTINGS;
  return {
    siteName: row.site_name ?? DEFAULT_SETTINGS.siteName,
    tagline: row.tagline ?? DEFAULT_SETTINGS.tagline,
    heroTitle: row.hero_title ?? DEFAULT_SETTINGS.heroTitle,
    heroIntro: row.hero_intro ?? DEFAULT_SETTINGS.heroIntro,
    rules: row.rules ?? DEFAULT_SETTINGS.rules,
    themeAccent: row.theme_accent ?? DEFAULT_SETTINGS.themeAccent,
    features: {
      commentModeration:
        row.comment_moderation ?? DEFAULT_SETTINGS.features.commentModeration,
      allowImageComments:
        row.allow_image_comments ?? DEFAULT_SETTINGS.features.allowImageComments
    },
    support: {
      whatsappNumber: row.support_whatsapp_number ?? DEFAULT_SETTINGS.support.whatsappNumber,
      whatsappMessage: row.support_whatsapp_message ?? DEFAULT_SETTINGS.support.whatsappMessage
    },
    donation: {
      enabled: row.donation_enabled ?? DEFAULT_SETTINGS.donation.enabled,
      title: row.donation_title ?? DEFAULT_SETTINGS.donation.title,
      details: row.donation_details ?? DEFAULT_SETTINGS.donation.details,
      url: row.donation_url ?? DEFAULT_SETTINGS.donation.url
    },
    adSense: {
      enabled: row.adsense_enabled ?? DEFAULT_SETTINGS.adSense.enabled,
      publisherId: row.adsense_publisher_id ?? DEFAULT_SETTINGS.adSense.publisherId,
      slots: {
        homeTop: row.adsense_home_top ?? DEFAULT_SETTINGS.adSense.slots.homeTop,
        homeSidebar:
          row.adsense_home_sidebar ?? DEFAULT_SETTINGS.adSense.slots.homeSidebar,
        postInline:
          row.adsense_post_inline ?? DEFAULT_SETTINGS.adSense.slots.postInline
      }
    },
    themeId: row.theme_id ?? DEFAULT_SETTINGS.themeId
  };
}

function mapSettingsToRow(settings) {
  return {
    id: SETTINGS_ID,
    site_name: settings.siteName,
    tagline: settings.tagline,
    hero_title: settings.heroTitle,
    hero_intro: settings.heroIntro,
    rules: settings.rules,
    theme_accent: settings.themeAccent,
    comment_moderation: settings.features.commentModeration,
    allow_image_comments: settings.features.allowImageComments,
    support_whatsapp_number: settings.support.whatsappNumber,
    support_whatsapp_message: settings.support.whatsappMessage,
    donation_enabled: settings.donation.enabled,
    donation_title: settings.donation.title,
    donation_details: settings.donation.details,
    donation_url: settings.donation.url,
    adsense_enabled: settings.adSense.enabled,
    adsense_publisher_id: settings.adSense.publisherId,
    adsense_home_top: settings.adSense.slots.homeTop,
    adsense_home_sidebar: settings.adSense.slots.homeSidebar,
    adsense_post_inline: settings.adSense.slots.postInline,
    theme_id: settings.themeId || null,
    updated_at: new Date().toISOString()
  };
}

export async function fetchSettings() {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("*")
      .eq("id", SETTINGS_ID)
      .maybeSingle();
    if (error || !data) return DEFAULT_SETTINGS;
    return mapRowToSettings(data);
  } catch (error) {
    console.warn("Settings fetch failed", error);
    return DEFAULT_SETTINGS;
  }
}

export async function upsertSettings(settings) {
  return supabase.from("site_settings").upsert(mapSettingsToRow(settings)).select().single();
}
