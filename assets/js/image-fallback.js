/* Broken user-uploaded/CDN images should never show the browser's torn-image
   icon. The fallback is a local, license-independent SVG, not a remote stock photo. */
const MEDIA_PLACEHOLDER = "/assets/img/media-placeholder.svg";
const AVATAR_PLACEHOLDER = "/assets/img/avatar-placeholder.svg";

export function fallbackImagePath({ id = "", className = "", parentClassName = "" } = {}) {
  const kind = `${id} ${className} ${parentClassName}`.toLowerCase();
  return /avatar|portrait|user-photo|profile-photo|profile-picture/.test(kind)
    ? AVATAR_PLACEHOLDER : MEDIA_PLACEHOLDER;
}

export function installImageFallbacks(root = document) {
  if (root.__timzeeImageFallbacksInstalled) return;
  root.__timzeeImageFallbacksInstalled = true;
  // Image error events do not bubble; capture handles dynamically rendered
  // cards without a MutationObserver scanning every frontend update.
  root.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.fallbackApplied === "true") return;
    const replacement = fallbackImagePath({
      id: image.id,
      className: String(image.className || ""),
      parentClassName: String(image.parentElement?.className || "")
    });
    image.dataset.fallbackApplied = "true";
    image.removeAttribute("srcset");
    image.src = replacement;
    if (!image.hasAttribute("alt")) image.alt = "Image unavailable";
  }, true);
}

if (typeof document !== "undefined") installImageFallbacks(document);
