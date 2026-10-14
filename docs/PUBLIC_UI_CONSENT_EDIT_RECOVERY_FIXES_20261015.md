# Public UI, consent, editor and member recovery repairs — 15 October 2026

## Bugs and observed causes
- **Footer obstruction:** a fixed `#bottomTabBar` covers the bottom edge on mobile by design. The additional pale broken-image area was a separate website carousel `<img>` with a non-image article URL (`https://pragmapreneur.com/best-ai-tools-for-business/`) as its source. Public, read-only mobile-browser inspection found no injected iframe and no browser-generated ad surface.
- **Cookie banner missing:** an earlier `timzee_cookie_consent` value suppresses the notice intentionally. The footer's Cookie settings button existed but was difficult to find at the end of the page. Previous consent had no review timestamp.
- **Cannot edit:** the Super Admin All Posts list offered Preview, Publish, and Delete, but no Edit; Admin Manage Posts could populate the composer without switching the visible tab.
- **AI editor instructions published:** `curator-editorial-note` and other scaffolding appeared within the published HTML. Exactly three published posts had the known AI note in Supabase.
- **Former users:** the existing audience metrics were in Email Operations, but there was no discoverable link from the Super Admin Users section. Historic sign-in dates cannot prove actual inactivity or email marketing permission.

## Implemented
1. `assets/js/popularity-engine.js` now rejects obvious HTML article-page URLs as cover images. It uses a text fallback instead of broken-image areas. It also filters internal editorial notes from public excerpts.
2. `assets/css/navbar.css` reserves extra space below the mobile footer so fixed tab navigation does not obscure footer links. The tab bar remains intentional mobile navigation.
3. `assets/js/privacy-consent.js` keeps optional categories independently managed, records a timestamp for new consent, and re-prompts users with legacy/expired choices after an update. Until an explicit valid choice is made, optional categories default to off. `assets/js/nav.js` adds an always-available Cookie settings control to the mobile menu. The existing footer control is retained. Optional analytics in `visitor-analytics.js` already obeys the measurement choice.
4. `assets/js/admin.js` now opens the correct post directly with `admin/dashboard.html?editPost=<uuid>`, including posts beyond a preloaded management list; switches to Compose; preserves uncategorized posts; does not create duplicates on update. The Super Admin All Posts page now includes an Edit post link.
5. `assets/js/public-editorial-content.mjs` strips only known curator/editorial notices. Public post content, previews and metadata use this filter; new curated publications and admin save actions strip scaffolding before saving. Hidden takeaway metadata remains intact.
6. `supabase/migrations/20261015011000_remove_published_editorial_status_notes.sql` **applied to Supabase**. Exactly three originally affected posts had the known note removed. A read-only check afterwards confirmed 6 published posts, 0 remaining internal AI notices and 3 posts preserving saved takeaway metadata. No posts were deleted.
7. Super Admin **Users → Bring members back** now links directly to dormant-audience reporting and provides a copyable public comeback invitation. `super/email-operations.html?legacyRecovery=1` opens the existing read-only stats. Nothing enrolls past users into email campaigns without the required permission.
8. `tests/public-content-consent-recovery.test.cjs` adds regression coverage for cleanup, cookie choice persistence, editor links, image filtering and audience reporting. Source scripts and test file passed JavaScript syntax checks. Synthetic utility tests rejected the invalid article-image URL and removed editor notes while preserving takeaways.

## What remains before announcing production readiness
- GitHub Actions CI is blocked by the repository owner's billing lock. Syntax and synthetic checks are **not** full cross-device integration tests.
- Netlify credits exhausted: no new build, Deploy Preview or production publication was triggered. Current preview won't show frontend code changes until Netlify can rebuild the branch.
- On the next deployment: test fresh/no-consent banners, Reject optional, Accept optional, custom preference selection, reopening from Menu/Footer, and stopping optional analytics. Verify admin editor navigation and a real noncritical post update. Check the mobile footer and carousel at narrow widths.
- Historic inactive users without recorded email permission remain excluded from automatic marketing mail. The shareable invitation is a manual option where the owner already has permission to reach the contact. The Netlify email worker and inactivity feature gates remain OFF.
