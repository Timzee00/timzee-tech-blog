# Blipmood Lighthouse repairs — 2026-10-27

## Scope
These fixes address real Lighthouse audits of the Git-based production build
and the previous manually published Netlify Drop build. Do not confuse Netlify
preview SEO scores (which intentionally include X-Robots-Tag: noindex) with
indexability on a published production host.

## Repairs
1. Added RLS-preserving batched `get_post_engagement(uuid[])` server function.
   It avoids a 404 RPC and existing count fallbacks; maximum 24 visible posts.
2. Added atomic, UTC-day idempotent `record_post_view(uuid,uuid)` RPC with
   privately stored deduplication tokens. The browser no longer attempts an
   unauthorized UPDATE of public posts or generates HTTP 406 on that path.
   Tokens are best-effort anti-duplicate, **not** full bot prevention.
3. Reserved headline/takeaway layout during slow article fetches, defined cover
   and editorial-media dimensions, preserved responsive image fitting, and
   corrected Key Takeaways to an H2.
4. Added correctly dimensioned video thumbnails and four responsive skeleton
   cards before initial async video discovery to reduce footer jumps.
5. Fixed the Spaces mini-dock link to have a real initial href, and changed
   the Discussion community board heading from H3 to H2.
6. Made optional Google Fonts non-render-blocking on the homepage, and preloaded
   the large brand hero image. Kept a no-JS stylesheet fallback.
7. Switched bundled DOMPurify ESM to a minified build. License file remains.

## Checks
- Connected Supabase migration: 20261027215654, verified function grants and
  an engagement row without changing any user-authored post.
- `npm run build` exercises all existing checks plus
  `tests/lighthouse-remediations.test.cjs`.
- Re-run Lighthouse against the exact commit deployment and compare
  median of three mobile runs when possible; performance scores vary.
- No change to the intentional preview-only `noindex` mechanism.
- Authenticated operations, comment posting and publication still require
  authorized account-level end-to-end tests.
- Publishing a ready GitHub build to the named `blipmood.netlify.app` address
  remains a separate Netlify deployment action if the site is locked to Drop.
