# Timzee Scout + AI reliability checkpoint (15 October 2026)

## Read-only live findings

The live project `duvbcwwprkzzyzikmcol` currently contains **66 curator records**: **58 drafts** and **8 posted**.

The latest observed `curator-scout` job on 14 Oct at 22:52 UTC reported **partial**, not total failure: 15 new drafts across Billboard (5), Ars Technica (5), and GitHub Blog (5). One of four checked sources failed after a six-second timeout. Its source was `Env source 3`, using `https://site3.com/tips.rss`.

Three enabled rows originate from example feed entries:

- `Env source 1` → `https://site1.com/rss` (timed out)
- `Env source 2` → `https://site2.com/feed` (HTTP 500)
- `Env source 3` → `https://site3.com/tips.rss` (timed out)

These should not be considered working news publishers. The new PR #6 code skips known sample URLs in server-side scheduling and flags them in the curator source manager. **It does not change or delete any live database record.**

## Safe operator cleanup (requires human review)

1. In Netlify → Environment variables, inspect `NEWS_FEEDS` and `NEWS_TIPS_FEEDS`. Remove example addresses such as the three above and replace only with publisher-provided real RSS URLs. The variable may be scoped to one deploy context; ensure the intended production/preview contexts are configured.
2. In the Curator → Manage Sources screen, review and delete or disable the three known sample rows (if no real publisher intended). Existing article drafts should be retained.
3. Check `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as required, ensuring only server-side Functions scope. **Do not copy secrets into the chat, GitHub, frontend code or issue comments.**
4. Rebuild a staging/deploy-preview version that actually includes the new PR #6 commit. Commits contain `[skip netlify] [skip ci]` to conserve credits; they are **not automatically a new preview**.
5. In a staging account with trusted staff role, open Curator → Check AI setup. Verify both provider flags and the deploy context. This only checks configuration visibility—not key validity or available model access.
6. Test Translate to English and Expand with AI on isolated test drafts. In Automatic mode, the editor may use one alternate configured provider after an eligible HTTP failure. An explicit model choice does not silently switch vendors. The saved draft remains unpublished.
7. Test the inline article AI selector with a signed-in test reader, including missing-provider and failed-request paths. Verify typed input is retained when requests fail.
8. Run Scout in the staging curator dashboard. Confirm source outcomes are meaningful, non-placeholder feeds import source briefs, and the draft counts/status in Supabase match the UI.
9. Validate responsive preview, image licensing/placement, mobile mention suggestions with keyboard, video playback/cache, and pending database migration gates in `docs/ENGINEERING_AUDIT_2026-10-15.md`.

## What the implementation does not claim

- A Netlify credential visible in the dashboard is not proof it exists in this *specific deployed Function context* or that the provider will accept it.
- Source images require verified reuse rights and source attribution; images from RSS are not automatically licensed for republication.
- RSS summaries do not justify fabricated 1,000-word reporting; additional sources and an editorial review are necessary.
- A successful unit/isolated-source check is not a live model call, signed-in browser test, deploy verification, or proof of large-scale load capacity.
- The user-approved application and verification of chat, mention-notification, and other review-only SQL migrations still remain separate release gates.
