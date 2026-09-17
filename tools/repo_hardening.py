from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HARDENING_REVISION = "2026-09-17.4"

PROFILE_PUBLIC = (
    "id,display_name,username,avatar_url,cover_url,bio,headline,location,website,"
    "role,is_verified,is_featured,is_staff_pick,verification_tier,verified_at,"
    "points,level,created_at,allow_messages,allow_requests,show_email"
)
PROFILE_SELF = f"{PROFILE_PUBLIC},email,notify_messages,notify_replies"
MARKETPLACE_COLS = (
    "id,user_id,seller_name,title,description,category,subcategory,price,currency,"
    "condition,location,images,is_available,view_count,created_at,updated_at,expires_at"
)


def transform(path: str, fn) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    updated = fn(text)
    if updated != text:
        target.write_text(updated, encoding="utf-8")


def sub(text: str, pattern: str, replacement: str, path: str) -> str:
    updated, _ = re.subn(pattern, replacement, text, flags=re.S)
    return updated


# Keep the shared layer dependency-free and non-invasive. Page-specific file
# selection state must remain authoritative on marketplace/admin/verification pages.
(ROOT / "assets/js/app-hardening.js").write_text(
    '''/* Shared client hardening. Keep this module dependency-free. */\n(function initAppHardening() {\n  if (typeof window === "undefined" || window.__timzeeAppHardeningReady) return;\n  window.__timzeeAppHardeningReady = true;\n\n  function installVisualConsistency() {\n    if (document.getElementById("app-hardening-style")) return;\n    const style = document.createElement("style");\n    style.id = "app-hardening-style";\n    style.textContent = `\n      .app-dialog-actions button { border-radius: 10px !important; }\n      .site-menu-footer-actions .chip { border-radius: 999px; }\n      #appHardeningNotice { line-height: 1.4; }\n    `;\n    document.head.appendChild(style);\n  }\n\n  if (document.readyState === "loading") {\n    document.addEventListener("DOMContentLoaded", installVisualConsistency, { once: true });\n  } else {\n    installVisualConsistency();\n  }\n})();\n''',
    encoding="utf-8",
)


def patch_listing(text: str) -> str:
    text = sub(
        text,
        r'\.from\("marketplace_items"\)\s*\.select\("\*"\)\s*\.eq\("id", state\.itemId\)\s*\.single\(\)',
        f'.from("marketplace_items").select("{MARKETPLACE_COLS}").eq("id", state.itemId).single()',
        "listing.html",
    )
    text = sub(
        text,
        r'document\.getElementById\("price"\)\.textContent\s*=\s*`\$\$\{parseFloat\(listing\.price\)\.toFixed\(2\)\}`;',
        'document.getElementById("price").textContent = formatCurrency(listing.price, listing.currency);',
        "listing.html",
    )
    if 'function formatCurrency(price, currencyCode)' not in text:
        text = text.replace(
            '      function renderListing() {',
            '''      function formatCurrency(price, currencyCode) {\n        const symbols = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "₵", KES: "KSh " };\n        const currency = String(currencyCode || "USD").toUpperCase();\n        const symbol = symbols[currency] || `${currency} `;\n        const amount = Number(price);\n        return Number.isFinite(amount) ? `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Price unavailable";\n      }\n\n      function renderListing() {''',
            1,
        )
    text = text.replace("listing.seller_id", "listing.user_id")
    text = sub(
        text,
        r'if \(listing\.review_count > 0\) \{\s*loadReviews\(\);\s*\}',
        'loadReviews();',
        "listing.html",
    )
    text = sub(
        text,
        r'\.select\("\*"\)\s*\.eq\("seller_id", state\.listing\.user_id\)',
        '.select("id,reviewer_id,reviewee_id,rating,comment,created_at").eq("reviewee_id", state.listing.user_id)',
        "listing.html",
    )
    text = sub(
        text,
        r'\.select\("\*"\)\s*\.eq\("category", state\.listing\.category\)',
        '.select("id,user_id,seller_name,title,price,currency,images,is_available").eq("category", state.listing.category)',
        "listing.html",
    )
    text = text.replace('<div class="similar-card-placeholder">📦</div>', '<div class="similar-card-placeholder">No image</div>', 1)
    text = sub(
        text,
        r'<div class="similar-card-price">\$\$\{escapeHTML\(\(parseFloat\(item\.price\) \|\| 0\)\.toFixed\(2\)\)\}</div>',
        '<div class="similar-card-price">${escapeHTML(formatCurrency(item.price, item.currency))}</div>',
        "listing.html",
    )
    text = sub(
        text,
        r'// Could open a direct message or contact form here\s*alert\("Opening contact with " \+ state\.listing\.seller_name\);',
        '''const sellerId = state.listing.user_id;\n          const status = document.getElementById("inquiryStatus");\n          if (!sellerId) {\n            status.style.display = "block";\n            status.textContent = "Seller contact is unavailable for this listing.";\n            status.style.color = "#b91c1c";\n            return;\n          }\n          if (sellerId === state.user.id) {\n            status.style.display = "block";\n            status.textContent = "This is your own listing.";\n            status.style.color = "#64748b";\n            return;\n          }\n          window.location.href = `chat.html?user=${encodeURIComponent(sellerId)}`;''',
        "listing.html",
    )
    text = text.replace('const message = document.getElementById("inquiryMessage").value;', 'const message = document.getElementById("inquiryMessage").value.trim();', 1)
    text = sub(
        text,
        r'(?P<prefix>\s*)status\.style\.display = "block";\s*status\.textContent = "Sending\.\.\.";',
        '''\g<prefix>if (!message) {\n\g<prefix>  status.style.display = "block";\n\g<prefix>  status.textContent = "Please enter a message.";\n\g<prefix>  status.style.color = "#b91c1c";\n\g<prefix>  return;\n\g<prefix>}\n\g<prefix>const submitButton = document.querySelector('#inquiryForm button[type="submit"]');\n\g<prefix>if (submitButton) submitButton.disabled = true;\n\g<prefix>status.style.display = "block";\n\g<prefix>status.textContent = "Sending...";''',
        "listing.html",
    )
    text = text.replace('sellerId: state.listing.seller_id,', 'sellerId: state.listing.user_id,', 1)
    text = sub(
        text,
        r'(\s*)\} catch \(error\) \{\s*status\.textContent = `Error: \$\{error\.message\}`;\s*status\.style\.color = "#ef4444";\s*\}\s*\}\);',
        r'''\1} catch (error) {\n\1  status.textContent = `Error: ${error.message}`;\n\1  status.style.color = "#ef4444";\n\1} finally {\n\1  if (submitButton) submitButton.disabled = false;\n\1}\n\1});''',
        "listing.html",
    )
    return text


transform("listing.html", patch_listing)


def patch_profile(text: str) -> str:
    text = sub(
        text,
        r'supabase\.from\("profiles"\)\.select\("\*"\)\.eq\("id", user\.id\)\.maybeSingle\(\)',
        f'supabase.from("profiles").select("{PROFILE_SELF}").eq("id", user.id).maybeSingle()',
        "assets/js/profile.js",
    )
    text = text.replace('role: user.user_metadata?.role || "user",', 'role: getUserRole(user),', 1)
    text = sub(
        text,
        r'async function loadProfile\(viewingId\) \{.*?\n\}',
        f'''async function loadProfile(viewingId) {{\n  const isSelf = !!state.user && state.user.id === viewingId;\n  const columns = isSelf ? "{PROFILE_SELF}" : "{PROFILE_PUBLIC}";\n  const result = await supabase.from("profiles").select(columns).eq("id", viewingId).maybeSingle();\n  return result.data || null;\n}}''',
        "assets/js/profile.js",
    )
    text = text.replace('state.user.user_metadata?.role || "user"', 'getUserRole(state.user)')
    return text


transform("assets/js/profile.js", patch_profile)


def patch_chat(text: str) -> str:
    text = text.replace(
        'from("profiles").select("*").in("id", Array.from(profileIds))',
        f'from("profiles").select("{PROFILE_PUBLIC}").in("id", Array.from(profileIds))',
    )
    text = text.replace(
        'supabase.from("profiles").select("*").in("id", ids)',
        f'supabase.from("profiles").select("{PROFILE_PUBLIC}").in("id", ids)',
    )
    return text


transform("assets/js/chat.js", patch_chat)


def patch_post(text: str) -> str:
    return text.replace(
        '.from("profiles")\n        .select("*")',
        f'.from("profiles")\n        .select("{PROFILE_PUBLIC}")',
    )


transform("assets/js/post.js", patch_post)


def patch_marketplace_module(text: str) -> str:
    text = re.sub(
        r'(\.from\("marketplace_items"\)\s*\.select\()"\*"(\))',
        rf'\1"{MARKETPLACE_COLS}"\2',
        text,
    )
    inquiry_pattern = re.compile(
        r'export async function createMarketplaceInquiry\(\{.*?\n\}\n\nexport async function getMarketplaceInquiries',
        re.S,
    )
    inquiry_replacement = f'''export async function createMarketplaceInquiry({{\n  itemId,\n  buyerId,\n  sellerId = null,\n  buyerName,\n  message\n}} = {{}}) {{\n  const normalizedMessage = String(message || "").trim();\n  if (!itemId || !buyerId || !normalizedMessage) {{\n    return {{ error: new Error("Item, buyer, and message are required.") }};\n  }}\n\n  try {{\n    const listing = await supabase\n      .from("marketplace_items")\n      .select("user_id,is_available")\n      .eq("id", itemId)\n      .single();\n    if (listing.error) return {{ error: listing.error }};\n    if (!listing.data?.is_available) return {{ error: new Error("This listing is no longer available.") }};\n    if (!listing.data.user_id) return {{ error: new Error("Seller information is unavailable.") }};\n    if (listing.data.user_id === buyerId) return {{ error: new Error("You cannot inquire about your own listing.") }};\n\n    const authoritativeSellerId = listing.data.user_id;\n    return await supabase.from("marketplace_inquiries").insert({{\n      id: crypto.randomUUID(),\n      item_id: itemId,\n      buyer_id: buyerId,\n      seller_id: authoritativeSellerId,\n      buyer_name: buyerName || "Buyer",\n      message: normalizedMessage,\n      status: "pending",\n      created_at: new Date().toISOString()\n    }}).select().single();\n  }} catch (error) {{\n    return {{ error }};\n  }}\n}}\n\nexport async function getMarketplaceInquiries'''
    if inquiry_pattern.search(text):
        text = inquiry_pattern.sub(inquiry_replacement, text, count=1)
    else:
        # Already transformed: leave it untouched so the pass is idempotent.
        pass
    return text


transform("assets/js/videos-marketplace.js", patch_marketplace_module)


def patch_admin(text: str) -> str:
    if "const MAX_MEDIA_FILES = 8;" not in text:
        text = text.replace("let postMediaFiles = [];", "const MAX_MEDIA_FILES = 8;\nlet postMediaFiles = [];", 1)
    handler_pattern = re.compile(
        r'  const postMediaInput = document\.getElementById\("postMediaFiles"\);\n  if \(postMediaInput\) \{.*?\n  \}',
        re.S,
    )
    handler = '''  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) {\n    postMediaInput.addEventListener("change", () => {\n      const incoming = Array.from(postMediaInput.files || []);\n      const keys = new Set(postMediaFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));\n      for (const file of incoming) {\n        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;\n        if (keys.has(key)) continue;\n        if (postMediaFiles.length >= MAX_MEDIA_FILES) break;\n        postMediaFiles.push(file);\n        keys.add(key);\n      }\n      postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));\n      postMediaPreviewUrls = postMediaFiles.map((file) => URL.createObjectURL(file));\n      postMediaInput.value = "";\n      renderPostMediaPreview();\n    });\n  }'''
    if handler_pattern.search(text):
        text = handler_pattern.sub(handler, text, count=1)
    text = text.replace(
        '  postMediaFiles = [];\n  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));',
        '  postMediaFiles = [];\n  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) postMediaInput.value = "";\n  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));',
        1,
    )
    return text


transform("assets/js/admin.js", patch_admin)


def patch_verify(text: str) -> str:
    pattern = re.compile(r'      function handleFiles\(files\) \{.*?\n      \}', re.S)
    replacement = '''      function handleFiles(files) {\n        const existing = new Set(state.documents.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));\n        for (const file of files || []) {\n          if (file.size > 5 * 1024 * 1024) {\n            const status = document.getElementById("statusBox");\n            if (status) {\n              status.classList.add("error");\n              status.textContent = `${file.name} is too large (max 5MB).`;\n              status.style.display = "block";\n            }\n            continue;\n          }\n          const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;\n          if (existing.has(key)) continue;\n          state.documents.push(file);\n          existing.add(key);\n        }\n        docInput.value = "";\n        renderDocuments();\n      }'''
    if pattern.search(text):
        text = pattern.sub(replacement, text, count=1)
    return text


transform("verify.html", patch_verify)

# Trusted client-side role display must not rely on user-editable metadata.
transform(
    "assets/js/announcements.js",
    lambda text: text.replace('const role = user.user_metadata?.role;', 'const role = user.app_metadata?.role || "user";', 1),
)


# Repository-wide invariants. These intentionally fail the workflow instead of
# silently committing a partial hardening pass.
for path in ROOT.rglob("*.js"):
    if ".git" in path.parts or "node_modules" in path.parts:
        continue
    source = path.read_text(encoding="utf-8", errors="ignore")
    if re.search(r'from\(["\']profiles["\']\)\s*\.select\(["\']\*["\']\)', source):
        raise SystemExit(f"Raw profiles select(*) remains in {path.relative_to(ROOT)}")

listing = (ROOT / "listing.html").read_text(encoding="utf-8")
assert "Opening contact with" not in listing
assert "listing.seller_id" not in listing
assert "listing.review_count" not in listing
assert "chat.html?user=" in listing
assert "formatCurrency(listing.price, listing.currency)" in listing

marketplace = (ROOT / "assets/js/videos-marketplace.js").read_text(encoding="utf-8")
assert not re.search(r'from\(["\']marketplace_items["\']\)\s*\.select\(["\']\*["\']\)', marketplace)
assert "authoritativeSellerId" in marketplace

hardening = (ROOT / "assets/js/app-hardening.js").read_text(encoding="utf-8")
assert "setupMultiFileInputs" not in hardening
assert "setupListingContactFix" not in hardening

print(f"Hardening revision {HARDENING_REVISION}: transformations and static checks passed.")
