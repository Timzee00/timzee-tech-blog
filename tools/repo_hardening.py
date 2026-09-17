from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REVISION = "2026-09-17.5"

PROFILE_PUBLIC = (
    "id,display_name,username,avatar_url,cover_url,bio,headline,location,website,"
    "role,is_verified,is_featured,is_staff_pick,verification_tier,verified_at,"
    "points,level,created_at,allow_messages,allow_requests,show_email"
)
PROFILE_SELF = f"{PROFILE_PUBLIC},email,notify_messages,notify_replies"
MARKETPLACE_PUBLIC = (
    "id,user_id,seller_name,title,description,category,subcategory,price,currency,"
    "condition,location,images,is_available,view_count,created_at,updated_at,expires_at"
)


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace(text: str, old: str, new: str) -> str:
    return text.replace(old, new)


def regex(text: str, pattern: str, replacement: str, count: int = 0) -> str:
    return re.sub(pattern, replacement, text, count=count, flags=re.S)


def harden_app_layer() -> None:
    write(
        "assets/js/app-hardening.js",
        '''/* Shared client hardening. Page-specific state stays with each feature. */\n(function initAppHardening() {\n  if (typeof window === "undefined" || window.__timzeeAppHardeningReady) return;\n  window.__timzeeAppHardeningReady = true;\n\n  function installVisualConsistency() {\n    if (document.getElementById("app-hardening-style")) return;\n    const style = document.createElement("style");\n    style.id = "app-hardening-style";\n    style.textContent = `\n      .app-dialog-actions button { border-radius: 10px !important; }\n      .site-menu-footer-actions .chip { border-radius: 999px; }\n      #appHardeningNotice { line-height: 1.4; }\n    `;\n    document.head.appendChild(style);\n  }\n\n  if (document.readyState === "loading") {\n    document.addEventListener("DOMContentLoaded", installVisualConsistency, { once: true });\n  } else {\n    installVisualConsistency();\n  }\n})();\n''',
    )


def harden_listing() -> None:
    path = "listing.html"
    text = read(path)
    text = regex(
        text,
        r'\.from\("marketplace_items"\)\s*\.select\("\*"\)\s*\.eq\("id", state\.itemId\)\s*\.single\(\)',
        f'.from("marketplace_items").select("{MARKETPLACE_PUBLIC}").eq("id", state.itemId).single()',
        1,
    )
    if "function formatCurrency(price, currencyCode)" not in text:
        text = text.replace(
            "      function renderListing() {",
            '''      function formatCurrency(price, currencyCode) {\n        const symbols = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "₵", KES: "KSh " };\n        const currency = String(currencyCode || "USD").toUpperCase();\n        const symbol = symbols[currency] || `${currency} `;\n        const amount = Number(price);\n        return Number.isFinite(amount)\n          ? `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`\n          : "Price unavailable";\n      }\n\n      function renderListing() {''',
            1,
        )
    text = replace(text, 'document.getElementById("price").textContent = `$${parseFloat(listing.price).toFixed(2)}`;', 'document.getElementById("price").textContent = formatCurrency(listing.price, listing.currency);')
    text = replace(text, "listing.seller_id", "listing.user_id")
    text = regex(text, r'if \(listing\.review_count > 0\) \{\s*loadReviews\(\);\s*\}', 'loadReviews();', 1)
    text = regex(text, r'\.select\("\*"\)\s*\.eq\("seller_id", state\.listing\.user_id\)', '.select("id,reviewer_id,reviewee_id,rating,comment,created_at").eq("reviewee_id", state.listing.user_id)', 1)
    text = regex(text, r'\.select\("\*"\)\s*\.eq\("category", state\.listing\.category\)', '.select("id,user_id,seller_name,title,price,currency,images,is_available").eq("category", state.listing.category)', 1)
    text = replace(text, '<div class="similar-card-placeholder">📦</div>', '<div class="similar-card-placeholder">No image</div>')
    text = replace(text, '<div class="similar-card-price">$${escapeHTML((parseFloat(item.price) || 0).toFixed(2))}</div>', '<div class="similar-card-price">${escapeHTML(formatCurrency(item.price, item.currency))}</div>')
    text = regex(
        text,
        r'// Could open a direct message or contact form here\s*alert\("Opening contact with " \+ state\.listing\.seller_name\);',
        '''const sellerId = state.listing.user_id;\n          const status = document.getElementById("inquiryStatus");\n          if (!sellerId) {\n            status.style.display = "block";\n            status.textContent = "Seller contact is unavailable for this listing.";\n            status.style.color = "#b91c1c";\n            return;\n          }\n          if (sellerId === state.user.id) {\n            status.style.display = "block";\n            status.textContent = "This is your own listing.";\n            status.style.color = "#64748b";\n            return;\n          }\n          window.location.href = `chat.html?user=${encodeURIComponent(sellerId)}`;''',
        1,
    )
    text = replace(text, 'const message = document.getElementById("inquiryMessage").value;', 'const message = document.getElementById("inquiryMessage").value.trim();')
    text = replace(text, '              sellerId: state.listing.seller_id,', '              sellerId: state.listing.user_id,')
    write(path, text)


def harden_profiles() -> None:
    path = "assets/js/profile.js"
    text = read(path)
    text = replace(text, 'supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()', f'supabase.from("profiles").select("{PROFILE_SELF}").eq("id", user.id).maybeSingle()')
    text = replace(text, 'role: user.user_metadata?.role || "user",', 'role: getUserRole(user),')
    text = regex(
        text,
        r'async function loadProfile\(viewingId\) \{.*?\n\}',
        f'''async function loadProfile(viewingId) {{\n  const isSelf = !!state.user && state.user.id === viewingId;\n  const columns = isSelf ? "{PROFILE_SELF}" : "{PROFILE_PUBLIC}";\n  const result = await supabase.from("profiles").select(columns).eq("id", viewingId).maybeSingle();\n  return result.data || null;\n}}''',
        1,
    )
    text = replace(text, 'state.user.user_metadata?.role || "user"', 'getUserRole(state.user)')
    write(path, text)


def harden_chat_and_post() -> None:
    path = "assets/js/chat.js"
    text = read(path)
    text = replace(text, 'from("profiles").select("*").in("id", Array.from(profileIds))', f'from("profiles").select("{PROFILE_PUBLIC}").in("id", Array.from(profileIds))')
    text = replace(text, 'supabase.from("profiles").select("*").in("id", ids)', f'supabase.from("profiles").select("{PROFILE_PUBLIC}").in("id", ids)')
    write(path, text)

    path = "assets/js/post.js"
    text = read(path)
    text = replace(text, '.from("profiles")\n        .select("*")', f'.from("profiles")\n        .select("{PROFILE_PUBLIC}")')
    write(path, text)


def harden_marketplace_module() -> None:
    path = "assets/js/videos-marketplace.js"
    text = read(path)
    text = regex(text, r'(\.from\("marketplace_items"\)\s*\.select\()"\*"(\))', rf'\1"{MARKETPLACE_PUBLIC}"\2')

    inquiry = regex(
        text,
        r'export async function createMarketplaceInquiry\(\{.*?\n\}\n\nexport async function getMarketplaceInquiries',
        '''export async function createMarketplaceInquiry({\n  itemId,\n  buyerId,\n  sellerId = null,\n  buyerName,\n  message\n} = {}) {\n  const normalizedMessage = String(message || "").trim();\n  if (!itemId || !buyerId || !normalizedMessage) {\n    return { error: new Error("Item, buyer, and message are required.") };\n  }\n\n  try {\n    const listing = await supabase\n      .from("marketplace_items")\n      .select("user_id,is_available")\n      .eq("id", itemId)\n      .single();\n    if (listing.error) return { error: listing.error };\n    if (!listing.data?.is_available) return { error: new Error("This listing is no longer available.") };\n    if (!listing.data.user_id) return { error: new Error("Seller information is unavailable.") };\n    if (listing.data.user_id === buyerId) return { error: new Error("You cannot inquire about your own listing.") };\n\n    return await supabase.from("marketplace_inquiries").insert({\n      id: crypto.randomUUID(),\n      item_id: itemId,\n      buyer_id: buyerId,\n      seller_id: listing.data.user_id,\n      buyer_name: buyerName || "Buyer",\n      message: normalizedMessage,\n      status: "pending",\n      created_at: new Date().toISOString()\n    }).select().single();\n  } catch (error) {\n    return { error };\n  }\n}\n\nexport async function getMarketplaceInquiries''',
        1,
    )
    text = inquiry if inquiry != text else text
    write(path, text)


def harden_admin_media() -> None:
    path = "assets/js/admin.js"
    text = read(path)
    if "const MAX_MEDIA_FILES = 8;" not in text:
        text = text.replace("let postMediaFiles = [];", "const MAX_MEDIA_FILES = 8;\nlet postMediaFiles = [];", 1)
    handler = '''  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) {\n    postMediaInput.addEventListener("change", () => {\n      const incoming = Array.from(postMediaInput.files || []);\n      const keys = new Set(postMediaFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));\n      for (const file of incoming) {\n        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;\n        if (keys.has(key)) continue;\n        if (postMediaFiles.length >= MAX_MEDIA_FILES) break;\n        postMediaFiles.push(file);\n        keys.add(key);\n      }\n      postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));\n      postMediaPreviewUrls = postMediaFiles.map((file) => URL.createObjectURL(file));\n      postMediaInput.value = "";\n      renderPostMediaPreview();\n    });\n  }'''
    if "const incoming = Array.from(postMediaInput.files || [])" not in text:
        text = regex(text, r'  const postMediaInput = document\.getElementById\("postMediaFiles"\);\n  if \(postMediaInput\) \{.*?\n  \}', handler, 1)
    text = replace(
        text,
        '  postMediaFiles = [];\n  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));',
        '  postMediaFiles = [];\n  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) postMediaInput.value = "";\n  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));',
    )
    write(path, text)


def harden_verification_upload() -> None:
    path = "verify.html"
    text = read(path)
    handler = '''      function handleFiles(files) {\n        const existing = new Set(state.documents.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));\n        for (const file of files || []) {\n          if (file.size > 5 * 1024 * 1024) {\n            const status = document.getElementById("statusBox");\n            if (status) {\n              status.classList.add("error");\n              status.textContent = `${file.name} is too large (max 5MB).`;\n              status.style.display = "block";\n            }\n            continue;\n          }\n          const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;\n          if (existing.has(key)) continue;\n          state.documents.push(file);\n          existing.add(key);\n        }\n        docInput.value = "";\n        renderDocuments();\n      }'''
    text = regex(text, r'      function handleFiles\(files\) \{.*?\n      \}', handler, 1)
    write(path, text)


def harden_announcements() -> None:
    path = "assets/js/announcements.js"
    text = read(path)
    text = replace(text, 'const role = user.user_metadata?.role;', 'const role = user.app_metadata?.role || "user";')
    write(path, text)


def validate() -> None:
    for path in ROOT.rglob("*.js"):
        if ".git" in path.parts or "node_modules" in path.parts:
            continue
        source = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r'from\(["\']profiles["\']\)\s*\.select\(["\']\*["\']\)', source):
            raise SystemExit(f"Raw profiles select(*) remains in {path.relative_to(ROOT)}")

    listing = read("listing.html")
    required = [
        "formatCurrency(listing.price, listing.currency)",
        "chat.html?user=",
        "listing.user_id",
    ]
    for item in required:
        if item not in listing:
            raise SystemExit(f"Listing invariant missing: {item}")
    if "Opening contact with" in listing or "listing.seller_id" in listing or "listing.review_count" in listing:
        raise SystemExit("Stale listing integration remains")

    marketplace = read("assets/js/videos-marketplace.js")
    if re.search(r'from\(["\']marketplace_items["\']\)\s*\.select\(["\']\*["\']\)', marketplace):
        raise SystemExit("Raw marketplace_items select(*) remains")
    if "listing.data.user_id" not in marketplace:
        raise SystemExit("Marketplace inquiry is not seller-authoritative")

    hardening = read("assets/js/app-hardening.js")
    if "setupMultiFileInputs" in hardening or "setupListingContactFix" in hardening:
        raise SystemExit("Shared hardening still overrides page-specific state")

    verify = read("verify.html")
    if 'docInput.value = "";' not in verify:
        raise SystemExit("Verification file picker is not reset after selection")

    admin = read("assets/js/admin.js")
    if "const MAX_MEDIA_FILES = 8;" not in admin or "postMediaFiles.push(file)" not in admin:
        raise SystemExit("Admin gallery is not accumulative and capped")


if __name__ == "__main__":
    harden_app_layer()
    harden_listing()
    harden_profiles()
    harden_chat_and_post()
    harden_marketplace_module()
    harden_admin_media()
    harden_verification_upload()
    harden_announcements()
    validate()
    print(f"Hardening revision {REVISION}: transformations and static checks passed.")
