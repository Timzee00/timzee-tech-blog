from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HARDENING_REVISION = "2026-09-17.3"


def edit(path: str, fn) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    updated = fn(text)
    if updated != text:
        target.write_text(updated, encoding="utf-8")


def replace_once(text: str, old: str, new: str, path: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise SystemExit(f"Expected pattern not found in {path}")


# The previous shared hardening layer interfered with page-specific multi-file
# state and used a brittle seller-id lookup. Keep the shared layer visual-only.
(ROOT / "assets/js/app-hardening.js").write_text(
    '''/* Shared client hardening. Keep this module dependency-free. */\n(function initAppHardening() {\n  if (typeof window === "undefined" || window.__timzeeAppHardeningReady) return;\n  window.__timzeeAppHardeningReady = true;\n\n  function installVisualConsistency() {\n    if (document.getElementById("app-hardening-style")) return;\n    const style = document.createElement("style");\n    style.id = "app-hardening-style";\n    style.textContent = `\n      .app-dialog-actions button { border-radius: 10px !important; }\n      .site-menu-footer-actions .chip { border-radius: 999px; }\n      #appHardeningNotice { line-height: 1.4; }\n    `;\n    document.head.appendChild(style);\n  }\n\n  if (document.readyState === "loading") {\n    document.addEventListener("DOMContentLoaded", installVisualConsistency, { once: true });\n  } else {\n    installVisualConsistency();\n  }\n})();\n''',
    encoding="utf-8",
)


def patch_listing(text: str) -> str:
    text = replace_once(
        text,
        '.select("*")\n            .eq("id", state.itemId)\n            .single();',
        '.select("id,user_id,seller_name,title,description,category,subcategory,price,currency,condition,location,images,is_available,view_count,created_at,updated_at,expires_at")\n            .eq("id", state.itemId)\n            .single();',
        "listing.html",
    )
    text = replace_once(
        text,
        'document.getElementById("price").textContent = `$${parseFloat(listing.price).toFixed(2)}`;',
        'const currencySymbols = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "₵", KES: "KSh " };\n        const currency = String(listing.currency || "USD").toUpperCase();\n        const symbol = currencySymbols[currency] || `${currency} `;\n        const amount = Number(listing.price);\n        document.getElementById("price").textContent = Number.isFinite(amount) ? `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Price unavailable";',
        "listing.html",
    )
    text = replace_once(
        text,
        'getSellerRating(listing.seller_id).then(rating => {',
        'getSellerRating(listing.user_id).then(rating => {',
        "listing.html",
    )
    text = replace_once(
        text,
        'if (state.user && listing.is_available && state.user.id !== listing.seller_id) {',
        'if (state.user && listing.is_available && state.user.id !== listing.user_id) {',
        "listing.html",
    )
    text = replace_once(
        text,
        'if (listing.review_count > 0) {\n          loadReviews();\n        }',
        'loadReviews();',
        "listing.html",
    )
    text = replace_once(
        text,
        '.select("*")\n            .eq("seller_id", state.listing.seller_id)',
        '.select("id,reviewer_id,reviewee_id,rating,comment,created_at")\n            .eq("reviewee_id", state.listing.user_id)',
        "listing.html",
    )
    text = replace_once(
        text,
        '.select("*")\n            .eq("category", state.listing.category)',
        '.select("id,user_id,seller_name,title,price,currency,images,is_available")\n            .eq("category", state.listing.category)',
        "listing.html",
    )
    text = text.replace(
        '<div class="similar-card-placeholder">📦</div>',
        '<div class="similar-card-placeholder">No image</div>',
        1,
    )
    text = replace_once(
        text,
        '<div class="similar-card-price">$${escapeHTML((parseFloat(item.price) || 0).toFixed(2))}</div>',
        '<div class="similar-card-price">${escapeHTML(formatCurrency(item.price, item.currency))}</div>',
        "listing.html",
    )
    marker = '      function renderListing() {'
    if marker in text and 'function formatCurrency(price, currencyCode)' not in text:
        text = text.replace(
            marker,
            '''      function formatCurrency(price, currencyCode) {\n        const symbols = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "₵", KES: "KSh " };\n        const currency = String(currencyCode || "USD").toUpperCase();\n        const symbol = symbols[currency] || `${currency} `;\n        const amount = Number(price);\n        return Number.isFinite(amount) ? `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Price unavailable";\n      }\n\n      function renderListing() {''',
            1,
        )
    text = replace_once(
        text,
        '// Could open a direct message or contact form here\n          alert("Opening contact with " + state.listing.seller_name);',
        '''const sellerId = state.listing.user_id;\n          if (!sellerId) {\n            const status = document.getElementById("inquiryStatus");\n            status.style.display = "block";\n            status.textContent = "Seller contact is unavailable for this listing.";\n            status.style.color = "#b91c1c";\n            return;\n          }\n          if (sellerId === state.user.id) {\n            const status = document.getElementById("inquiryStatus");\n            status.style.display = "block";\n            status.textContent = "This is your own listing.";\n            status.style.color = "#64748b";\n            return;\n          }\n          window.location.href = `chat.html?user=${encodeURIComponent(sellerId)}`;''',
        "listing.html",
    )
    text = replace_once(
        text,
        'const message = document.getElementById("inquiryMessage").value;\n          const status =',
        'const message = document.getElementById("inquiryMessage").value.trim();\n          const status =',
        "listing.html",
    )
    text = replace_once(
        text,
        '          status.style.display = "block";\n          status.textContent = "Sending...";',
        '''          if (!message) {\n            status.style.display = "block";\n            status.textContent = "Please enter a message.";\n            status.style.color = "#b91c1c";\n            return;\n          }\n\n          const submitButton = document.querySelector('#inquiryForm button[type="submit"]');\n          if (submitButton) submitButton.disabled = true;\n          status.style.display = "block";\n          status.textContent = "Sending...";''',
        "listing.html",
    )
    text = replace_once(
        text,
        '              sellerId: state.listing.seller_id,',
        '              sellerId: state.listing.user_id,',
        "listing.html",
    )
    text = replace_once(
        text,
        '''          } catch (error) {\n            status.textContent = `Error: ${error.message}`;\n            status.style.color = "#ef4444";\n          }\n        });''',
        '''          } catch (error) {\n            status.textContent = `Error: ${error.message}`;\n            status.style.color = "#ef4444";\n          } finally {\n            if (submitButton) submitButton.disabled = false;\n          }\n        });''',
        "listing.html",
    )
    return text


edit("listing.html", patch_listing)

PROFILE_PUBLIC = "id,display_name,username,avatar_url,cover_url,bio,headline,location,website,role,is_verified,is_featured,is_staff_pick,verification_tier,verified_at,points,level,created_at,allow_messages,allow_requests,show_email"


def patch_profile(text: str) -> str:
    text = replace_once(
        text,
        'const existing = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();',
        f'const existing = await supabase.from("profiles").select("{PROFILE_PUBLIC},email,notify_messages,notify_replies").eq("id", user.id).maybeSingle();',
        "assets/js/profile.js",
    )
    text = text.replace(
        'role: user.user_metadata?.role || "user",',
        'role: getUserRole(user),',
        1,
    )
    text = replace_once(
        text,
        'async function loadProfile(viewingId) {\n  const result = await supabase.from("profiles").select("*").eq("id", viewingId).maybeSingle();\n  return result.data || null;\n}',
        f'''async function loadProfile(viewingId) {{\n  const isSelf = !!state.user && state.user.id === viewingId;\n  const columns = isSelf\n    ? "{PROFILE_PUBLIC},email,notify_messages,notify_replies"\n    : "{PROFILE_PUBLIC}";\n  const result = await supabase.from("profiles").select(columns).eq("id", viewingId).maybeSingle();\n  return result.data || null;\n}}''',
        "assets/js/profile.js",
    )
    text = text.replace('state.user.user_metadata?.role || "user"', 'getUserRole(state.user)', 2)
    return text


edit("assets/js/profile.js", patch_profile)


def patch_chat(text: str) -> str:
    replacements = {
        'from("profiles").select("*").in("id", Array.from(profileIds))': f'from("profiles").select("{PROFILE_PUBLIC}").in("id", Array.from(profileIds))',
        'supabase.from("profiles").select("*").in("id", ids)': f'supabase.from("profiles").select("{PROFILE_PUBLIC}").in("id", ids)',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


edit("assets/js/chat.js", patch_chat)


def patch_post(text: str) -> str:
    return text.replace(
        '''        .from("profiles")\n        .select("*")''',
        f'''        .from("profiles")\n        .select("{PROFILE_PUBLIC}")''',
    )


edit("assets/js/post.js", patch_post)

MARKETPLACE_COLS = "id,user_id,seller_name,title,description,category,subcategory,price,currency,condition,location,images,is_available,view_count,created_at,updated_at,expires_at"


def patch_marketplace(text: str) -> str:
    text = text.replace(
        'from("marketplace_items")\n      .select("*")',
        f'from("marketplace_items")\n      .select("{MARKETPLACE_COLS}")',
    )
    old = '''export async function createMarketplaceInquiry({\n  itemId,\n  buyerId,\n  sellerId = null,\n  buyerName,\n  message\n} = {}) {\n  return supabase.from("marketplace_inquiries").insert({'''
    new = '''export async function createMarketplaceInquiry({\n  itemId,\n  buyerId,\n  sellerId = null,\n  buyerName,\n  message\n} = {}) {\n  const normalizedMessage = String(message || "").trim();\n  if (!itemId || !buyerId || !normalizedMessage) {\n    return { error: new Error("Item, buyer, and message are required.") };\n  }\n\n  try {\n    const listing = await supabase\n      .from("marketplace_items")\n      .select("user_id,is_available")\n      .eq("id", itemId)\n      .single();\n    if (listing.error) return { error: listing.error };\n    if (!listing.data?.is_available) return { error: new Error("This listing is no longer available.") };\n    if (!listing.data.user_id) return { error: new Error("Seller information is unavailable.") };\n    if (listing.data.user_id === buyerId) return { error: new Error("You cannot inquire about your own listing.") };\n\n    const authoritativeSellerId = listing.data.user_id;\n    return await supabase.from("marketplace_inquiries").insert({'''
    text = replace_once(text, old, new, "assets/js/videos-marketplace.js")
    text = text.replace('    message,\n    status: "pending",', '    message: normalizedMessage,\n    status: "pending",', 1)
    text = text.replace('    seller_id: sellerId,', '    seller_id: authoritativeSellerId,', 1)
    text = text.replace('  }).select().single();\n}\n\nexport async function getMarketplaceInquiries', '  }).select().single();\n  } catch (error) {\n    return { error };\n  }\n}\n\nexport async function getMarketplaceInquiries', 1)
    return text


edit("assets/js/videos-marketplace.js", patch_marketplace)


def patch_admin(text: str) -> str:
    text = text.replace(
        'let postMediaFiles = [];',
        'const MAX_MEDIA_FILES = 8;\nlet postMediaFiles = [];',
        1,
    )
    old = '''  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) {\n    postMediaInput.addEventListener("change", () => {\n      postMediaFiles = Array.from(postMediaInput.files || []);\n      postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));\n      postMediaPreviewUrls = postMediaFiles.map((file) => URL.createObjectURL(file));\n      renderPostMediaPreview();\n    });\n  }'''
    new = '''  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) {\n    postMediaInput.addEventListener("change", () => {\n      const incoming = Array.from(postMediaInput.files || []);\n      const keys = new Set(postMediaFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));\n      for (const file of incoming) {\n        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;\n        if (keys.has(key)) continue;\n        if (postMediaFiles.length >= MAX_MEDIA_FILES) break;\n        postMediaFiles.push(file);\n        keys.add(key);\n      }\n      postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));\n      postMediaPreviewUrls = postMediaFiles.map((file) => URL.createObjectURL(file));\n      postMediaInput.value = "";\n      renderPostMediaPreview();\n    });\n  }'''
    text = replace_once(text, old, new, "assets/js/admin.js")
    text = text.replace(
        '  postMediaFiles = [];\n  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));',
        '  postMediaFiles = [];\n  const postMediaInput = document.getElementById("postMediaFiles");\n  if (postMediaInput) postMediaInput.value = "";\n  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));',
        1,
    )
    return text


edit("assets/js/admin.js", patch_admin)


def patch_verify(text: str) -> str:
    text = replace_once(
        text,
        '''      function handleFiles(files) {\n        for (const file of files) {\n          if (file.size > 5 * 1024 * 1024) {\n            alert(`${file.name} is too large (max 5MB)`);\n            continue;\n          }\n          state.documents.push(file);\n        }\n        renderDocuments();\n      }''',
        '''      function handleFiles(files) {\n        const existing = new Set(state.documents.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));\n        for (const file of files || []) {\n          if (file.size > 5 * 1024 * 1024) {\n            window.appUI?.toast?.(`${file.name} is too large (max 5MB).`, { tone: "warning", title: "Document skipped" });\n            continue;\n          }\n          const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;\n          if (existing.has(key)) continue;\n          state.documents.push(file);\n          existing.add(key);\n        }\n        docInput.value = "";\n        renderDocuments();\n      }''',
        "verify.html",
    )
    return text


edit("verify.html", patch_verify)


# Announcements UI should use the trusted in-memory role resolver.
edit(
    "assets/js/announcements.js",
    lambda text: text.replace("const role = user.user_metadata?.role;", "const role = user.app_metadata?.role || \"user\";", 1),
)


# Static regression checks across the whole repository.
for path in ROOT.rglob("*.js"):
    if ".git" in path.parts or "node_modules" in path.parts:
        continue
    source = path.read_text(encoding="utf-8", errors="ignore")
    if re.search(r'from\(["\']profiles["\']\)\s*\.select\(["\']\*["\']\)', source):
        raise SystemExit(f"Raw profiles select(*) remains in {path.relative_to(ROOT)}")

listing = (ROOT / "listing.html").read_text(encoding="utf-8")
assert "Opening contact with" not in listing
assert "chat.html?user=" in listing
assert "listing.seller_id" not in listing
assert 'listing.review_count' not in listing

marketplace = (ROOT / "assets/js/videos-marketplace.js").read_text(encoding="utf-8")
assert 'from("marketplace_items")\n      .select("*")' not in marketplace

print(f"Hardening revision {HARDENING_REVISION}: transformations and static checks passed.")
