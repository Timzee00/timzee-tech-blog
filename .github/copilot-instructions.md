# Repo summary for AI coding agents

Keep edits small and intentional. This is a static site with client-side JS and Netlify serverless functions. Focus on safety (don’t introduce new secrets, follow existing RLS/security patterns) and follow the project’s code conventions.

---

## Big picture
- Static frontend served from repo root (`index.html`, `*.html`) and ES modules under `assets/js/` (`type="module"` in HTML).
- Server-side logic lives in `netlify/functions/` (Netlify Functions) and is used for scheduled jobs (e.g., `scout-news`) and secure API proxying.
- Database: Supabase (SQL files: `SUPABASE_SCHEMA.sql`, `MODERATOR_AND_CURATOR_SCHEMA.sql`, etc.). RLS policies matter and are enforced via JWT user metadata role checks.

## Key developer workflows
- Local dev (fast): open the repo root in a static server, e.g. `python -m http.server 5173` (see `README.md`).
- Deploy: GitHub → Netlify; functions run only when deployed or via `netlify dev` locally.
- Environment variables required by production: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (optional) `GROQ_API_KEY`, `NEWS_FEEDS`, `NEWS_ENABLED`, etc. See `netlify.toml` and `README.md`.

## Important conventions & patterns (do this project-specific way)
- Supabase usage is direct in browser JS (`assets/js/supabase.js`); **do not** move `SERVICE_ROLE_KEY` to frontend. Service keys must remain server-side.
- Post `status` handling: `data.js` treats `null` or `published` as public; `scheduled` posts require `publish_at <= now` to show. Mirror this logic when adding queries or filters.
- Text search uses `search_vector` and `textSearch(..., { type: 'websearch' })` — preserve this pattern when changing search code.
- Tag queries use Postgres array operators (e.g., `.overlaps('tags', [...])`) — use same approach for compatibility.
- Sanitize all user HTML: XSS fixes are required (see `SECURITY_FIXES.md`). Prefer `textContent` or DOMPurify before `innerHTML`.
- Cron/scheduled functions detect `x-nf-event === 'schedule'`. Manual trigger paths often check auth with `Authorization: Bearer <token>` (see `netlify/functions/scout-news.js` → `requireSuperForManual`).

## Security & DB
- Critical fixes already in docs: move Groq key to `netlify/functions/groq-proxy.js` (see `SECURITY_FIXES.md`) and remove localStorage key usage in `assets/js/groq.js`.
- Add / update RLS policies in SQL migrations (`SUPABASE_SCHEMA.sql`, `FIX_RLS_POLICIES.sql`) when you change tables/permissions.
- When adding a feature that needs permissions, update: SQL schema, `TECHNICAL_REFERENCE.md` and any UI in `super/` or `admin/` panels.

## Testing & verification
- No automated test runner is present by default. Use `VERIFICATION_CHECKLIST.md`, `TESTING_CHECKLIST.md` to document manual tests and add unit/integration tests under a new `tests/` directory if you introduce logic that needs CI.
- To test functions locally use `netlify dev` (or deploy to a branch on Netlify) and set required env vars in the Netlify site settings.

## Files to inspect for related changes
- Frontend: `assets/js/{app.js,data.js,post.js,supabase.js,groq.js}`
- Server: `netlify/functions/*` (look for scheduled jobs e.g., `scout-news.js`)
- DB/schema: `SUPABASE_SCHEMA.sql`, `MODERATOR_AND_CURATOR_SCHEMA.sql`, `FIX_RLS_POLICIES.sql`
- Docs & guides: `START_HERE.md`, `README.md`, `SECURITY_FIXES.md`, `TECHNICAL_REFERENCE.md`, `GITHUB_NETLIFY_SETUP.md`

---

If anything above is unclear or you want more fine-grained rules (linting, commit message templates, or a test runner recommendation), tell me which area to expand and I’ll iterate. ✅
