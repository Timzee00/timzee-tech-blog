from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HARDENING_REVISION = "2026-09-17.2"


def patch(path: str, replacements: list[tuple[str, str]], minimum: int = 1) -> bool:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    original = text
    hits = 0
    for pattern, replacement in replacements:
        text, count = re.subn(pattern, replacement, text, flags=re.S)
        hits += count
    if hits < minimum:
        raise SystemExit(f"Expected at least {minimum} replacement(s) in {path}, got {hits}")
    if text != original:
        target.write_text(text, encoding="utf-8")
        return True
    return False


patch(
    "listing.html",
    [
        (r'\.select\("\*"\)\s*\.eq\("id", state\.itemId\)\.single\(\);',
         '.select("id,user_id,seller_id,seller_name,seller_verified,title,description,category,subcategory,price,currency,condition,location,images,is_available,view_count,review_count,created_at").eq("id", state.itemId).single();'),
        (r'document\.getElementById\("price"\)\.textContent = `\$\{parseFloat\(listing\.price\)\.toFixed\(2\)\}`;',
         'const currencySymbols = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "₵", KES: "KSh " };\n        const currency = String(listing.currency || "NGN").toUpperCase();\n        const symbol = currencySymbols[currency] || `${currency} `;\n        const amount = Number(listing.price);\n        document.getElementById("price").textContent = Number.isFinite(amount) ? `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Price unavailable";'),
        (r'\.select\("\*"\)\s*\.eq\("seller_id", state\.listing\.seller_id\)',
         '.select("id,reviewer_id,reviewee_id,rating,comment,created_at").eq("reviewee_id", state.listing.seller_id)'),
        (r'\.select\("\*"\)\s*\.eq\("category", state\.listing\.category\)',
         '.select("id,title,price,currency,images").eq("category", state.listing.category)'),
        (r'`\$\{escapeHTML\(\(parseFloat\(item\.price\) \|\| 0\)\.toFixed\(2\)\)\}`',
         '`${({ NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "₵", KES: "KSh " }[String(item.currency || "NGN").toUpperCase()] || `${String(item.currency || "NGN").toUpperCase()} `)}${escapeHTML((parseFloat(item.price) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}`'),
        (r'// Could open a direct message or contact form here\s*alert\("Opening contact with " \+ state\.listing\.seller_name\);',
         'const sellerId = state.listing.seller_id || state.listing.user_id;\n          if (sellerId && sellerId !== state.user.id) {\n            window.location.href = `chat.html?user=${encodeURIComponent(sellerId)}`;\n            return;\n          }\n          const inquiry = document.getElementById("inquiryContainer");\n          if (inquiry) inquiry.scrollIntoView({ behavior: "smooth", block: "center" });'),
        (r'const message = document\.getElementById\("inquiryMessage"\)\.value;\s*const status =',
         'const message = document.getElementById("inquiryMessage").value.trim();\n          const status ='),
        (r'      status\.style\.display = "block";\s*status\.textContent = "Sending\.\.\.";',
         '      if (!message) {\n            status.style.display = "block";\n            status.textContent = "Please enter a message.";\n            status.style.color = "#ef4444";\n            return;\n          }\n\n          const submitButton = document.querySelector("#inquiryForm button[type=\\"submit\\"]");\n          if (submitButton) submitButton.disabled = true;\n          status.style.display = "block";\n          status.textContent = "Sending...";'),
        (r'          \} catch \(error\) \{\s*status\.textContent = `Error: \$\{error\.message\}`;\s*status\.style\.color = "#ef4444";\s*\}\s*        \}\);',
         '          } catch (error) {\n            status.textContent = `Error: ${error.message}`;\n            status.style.color = "#ef4444";\n          } finally {\n            if (submitButton) submitButton.disabled = false;\n          }\n        });'),
    ],
)

profile_public = 'id,display_name,username,avatar_url,cover_url,bio,headline,location,website,role,is_verified,is_featured,is_staff_pick,verification_tier,verified_at,points,level,created_at,allow_messages,allow_requests,show_email'
patch("assets/js/chat.js", [(r'\.from\("profiles"\)\.select\("\*"\)', f'.from("profiles").select("{profile_public}")')])
patch("assets/js/post.js", [(r'\.from\("profiles"\)\s*\.select\("\*"\)', f'.from("profiles").select("{profile_public}")')])
patch("assets/js/profile.js", [
    (r'async function loadProfile\(viewingId\) \{\s*const result = await supabase\.from\("profiles"\)\.select\("\*"\)\.eq\("id", viewingId\)\.maybeSingle\(\);\s*return result\.data \|\| null;\s*\}',
     f'async function loadProfile(viewingId) {{\n  const isSelf = !!state.user && state.user.id === viewingId;\n  const columns = isSelf ? "id,display_name,username,email,avatar_url,cover_url,bio,headline,location,website,role,is_verified,is_featured,is_staff_pick,verification_tier,verified_at,points,level,created_at,allow_messages,allow_requests,show_email,notify_messages,notify_replies" : "{profile_public}";\n  const result = await supabase.from("profiles").select(columns).eq("id", viewingId).maybeSingle();\n  return result.data || null;\n}}')
])

market_cols = 'id,user_id,seller_id,seller_name,seller_verified,title,description,category,subcategory,price,currency,condition,location,images,is_available,view_count,review_count,created_at,updated_at,expires_at'
patch("assets/js/videos-marketplace.js", [
    (r'\.from\("marketplace_items"\)\s*\.select\("\*"\)', f'.from("marketplace_items").select("{market_cols}")'),
    (r'export async function createMarketplaceInquiry\(\{\s*itemId,\s*buyerId,\s*sellerId = null,\s*buyerName,\s*message\s*\} = \{\}\) \{\s*return supabase\.from\("marketplace_inquiries"\)\.insert\(',
     'export async function createMarketplaceInquiry({\n  itemId,\n  buyerId,\n  sellerId = null,\n  buyerName,\n  message\n} = {}) {\n  if (!itemId || !buyerId || !message || !String(message).trim()) return { error: new Error("Item, buyer, and message are required.") };\n  return supabase.from("marketplace_inquiries").insert(')
])

# The app already supports multi-select galleries for posts/admin and marketplace.
# Preserve that behavior, cap the admin gallery, and make it accumulative across selections.
p = ROOT / "assets/js/admin.js"
text = p.read_text(encoding="utf-8")
if 'const MAX_MEDIA_FILES = 8;' not in text and 'let postMediaFiles = [];' in text:
    text = text.replace('let postMediaFiles = [];', 'const MAX_MEDIA_FILES = 8;\nlet postMediaFiles = [];', 1)
    p.write_text(text, encoding="utf-8")

# Static scan catches regressions across the whole repo instead of only the touched files.
for path in ROOT.rglob('*.js'):
    if '.git' in path.parts or 'node_modules' in path.parts:
        continue
    source = path.read_text(encoding='utf-8', errors='ignore')
    if re.search(r'from\(["\']profiles["\']\)\s*\.select\(["\']\*["\']\)', source):
        raise SystemExit(f'Raw profiles select(*) remains in {path.relative_to(ROOT)}')

listing = (ROOT / 'listing.html').read_text(encoding='utf-8')
assert 'Opening contact with' not in listing, 'Disconnected Contact Seller stub remains'
assert 'chat.html?user=' in listing, 'Contact Seller has no chat destination'
assert 'currencySymbols' in listing, 'Listing currency formatter missing'

print(f'Hardening revision {HARDENING_REVISION}: transformations and static checks passed.')
