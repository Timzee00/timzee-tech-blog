# Curator & Super Admin Incident Fixes — 14 October 2026

## What screenshots revealed

1. The super-admin **Delete permanently** operation failed with `comments_post_id_fkey`: `comments.post_id` referenced `posts.id` without a delete action.
2. The curator's header used `grid-template-columns: 1fr auto` with two auto-sized statistics cards, squeezing the title on phones into a thin column. The admin sidebar and card constraints made the situation worse.
3. The AI article formatter `normalizedArticle()` called `.unshift()` on its `html` string after `.join("\\n")`, causing `html.unshift is not a function`. The AI can return otherwise valid content but the post never saves.
4. An RSS source brief without enough independently supported material is intentionally not accepted as a lengthy original article. Previously, the workflow explained this only by a toast and supplied no place for verified supplemental notes.
5. The image preview was inline ahead of the "Approved image URLs" label, creating an untidy label-wrap on mobile.

## Changes

- Supabase migration `20261014260000_cascade_post_comments_on_permanent_delete.sql` **applied successfully**. The `comments_post_id_fkey` now reads `FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE`; zero posts and comments were deleted by the migration. Existing bookmarks, likes, media, and shares already cascade.
- Super-admin delete confirmation now clearly states that comments and dependent content are removed, and provides a post-delete success message. This still requires active super-admin sign-in and database RLS permission.
- AI formatter leaves `html` as an array until after injecting verified takeaways, then joins to a string. A synthetic complete editorial draft of 1,292 words formatted successfully, retained source credit, and preserved takeaways.
- Curator cards now provide optional **Additional verified reporting** inputs: a real HTTPS source link, editor-provided factual context, and an explicit review checkbox. The authenticated expansion endpoint labels this as untrusted editor-supplied data, checks provenance-format and minimum evidence, and does **not** attempt scraping, plagiarism or fabricated expansion. The result remains a draft requiring human fact-checking; no automatic publishing.
- Expand failure messages explain specifically what additional evidence is required. Editors can still keep a brief for review rather than pad it into an unsupported full-length story.
- Curator and staff responsive layout improved on `<=960px`: full-width single-column admin workspace, horizontally scrollable staff navigation, grid header/stats stacking, properly wrapping action buttons, block-level image previews, full-width editorial inputs and touch-size buttons.
- Synthetic endpoint test: short excerpt alone returns HTTP 422 **without** calling provider. The same excerpt plus additional evidence returned HTTP 200 and saved a draft with `editorialReviewRequired=true`, no publication triggered. The mocked provider returned a complete structured article.
- `tests/curator-editorial-mobile.test.cjs` added for formatter, escaping, guards, mobile structure, and cascade migration. JavaScript syntax checks passed in the tool environment, but GitHub Actions still requires fixing its billing lock before full CI.

## Release boundaries

No Netlify build or production publication was triggered. The user's existing deploy preview is an older immutable snapshot and will continue showing the old failures until a subsequent deployment rebuilds this branch. Database FK schema fix is already live but no destructive delete was performed. Never run test deletes on real user posts; verify real post deletion only with a dedicated disposable post and comments after explicit approval. Preserve the editorial requirement for supporting evidence and image reuse permission.
