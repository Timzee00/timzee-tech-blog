import { supabase } from "./supabase.js";

export async function fetchThemeById(id) {
  if (!id) return null;
  const result = await supabase.from("themes").select("*").eq("id", id).maybeSingle();
  if (result.error) {
    console.warn("Theme fetch failed", result.error);
    return null;
  }
  return result.data || null;
}

export function applyThemeVariables(theme, scope = document.documentElement) {
  if (!theme || !scope) return;
  const map = {
    "--bg": theme.bg,
    "--bg-deep": theme.bg_deep,
    "--ink": theme.ink,
    "--muted": theme.muted,
    "--accent": theme.accent,
    "--accent-strong": theme.accent_strong,
    "--accent-cool": theme.accent_cool,
    "--card": theme.card,
    "--card-solid": theme.card_solid
  };

  Object.entries(map).forEach(([key, value]) => {
    if (value) {
      scope.style.setProperty(key, value);
    }
  });

  if (theme.wallpaper_url) {
    scope.style.setProperty("--wallpaper-image", `url("${theme.wallpaper_url}")`);
  } else {
    scope.style.removeProperty("--wallpaper-image");
  }
}
