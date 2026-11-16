# Deployment & Setup Guide

This guide explains how to set up and deploy the Timzee Tech Hub repo locally and to production (Netlify + Supabase). Follow the steps below carefully — run the SQL migrations in Supabase before you deploy the site.

---

## 1. Requirements
- Node.js 18+ (for local dev workflows if needed)
- A Supabase project (Postgres + Auth)
- A Netlify account (or any static host) for deployment
- Git and a GitHub repository

## 2. Quick summary
1. Run the guarded SQL migrations: `GUARDED_MIGRATIONS_AND_RLS_FIXES.sql` in the Supabase SQL editor. This will add missing columns, indexes, helper functions and the `add_chat_members` RPC used by the app.
2. Run tests (see `TESTING_INSTRUCTIONS.sql`).
3. Configure environment values (Supabase URL and ANON key) in `assets/js/supabase.js` or via your hosting provider's environment variables.
4. Deploy the site to Netlify. Set the required environment variables under Site settings.

---

## 3. Supabase setup (detailed)
1. Create a Supabase project.
2. In the **SQL Editor**, open `GUARDED_MIGRATIONS_AND_RLS_FIXES.sql` and run the script as an admin. Confirm no errors.
3. Verify created objects:
   - `public.add_chat_members` RPC exists
   - `comments.mentions`, `direct_messages.mentions` exist
   - Indexes on `comments.mentions` and `direct_messages.mentions` exist
   - Policies for `chat_members` were updated

4. Test with SQL (see `TESTING_INSTRUCTIONS.sql`)—use a known `profiles.id` to seed tests.

Notes:
- If your Supabase instance uses a different JWT metadata format, the `public.get_jwt_role()` helper will fallback to `profiles.role`.
- The RPC `add_chat_members` is `SECURITY DEFINER` and granted to the `authenticated` role so the client can call it safely.

---

## 4. Client configuration
- The repo currently contains a default `assets/js/supabase.js` with constants for `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- For production, do NOT commit service_role keys; use only the anon key in client-side code.

Recommended options:
- Option A (simple): Edit `assets/js/supabase.js` and replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your project's values before deploying.
- Option B (recommended for automation): Use the hosting platform's environment variables and inject them at build time (Netlify can set `BUILD_*` envs or you can use a small script that writes a `config.js` during CI).

Also set `SITE_URL` in `assets/js/supabase.js` to your production URL for reset-password/redirect flows.

---

## 5. Local dev & testing
- The site is static HTML/JS/CSS. You can serve it locally with:
  - `python -m http.server 8000` (from repo root) or
  - using the VS Code Live Server extension.

- Run the SQL tests in `TESTING_INSTRUCTIONS.sql` to verify migrations.

---

## 6. Deployment (Netlify)
1. Create a new site from Git in Netlify and connect your GitHub repo.
2. Set environment variables in Site settings → Build & deploy → Environment:
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_ANON_KEY` = your Supabase anon key
   - `SITE_URL` = your site URL (e.g., https://example.netlify.app)
3. Build command: none required for plain static repo — Netlify will publish `index.html` by default. If you add a build step, configure accordingly.
4. Add deploy previews and branch protection if you use a staging workflow.

---

## 7. Post-deploy checks & QA
- Verify login/signup flow on production (tokens, redirects).
- Create a new group using the **New Group** modal — ensure members were added (no RLS errors) and chat messages work.
- Post a comment with mentions to verify `mentions` column is present and working.
- Mobile checks: confirm no horizontal overflow and that the friend-picker modal behaves properly.

---

## 8. Troubleshooting
- RLS errors when adding chat members: ensure `public.add_chat_members` exists and is granted to `authenticated`, and re-run the migration script.
- Missing column errors: re-run `GUARDED_MIGRATIONS_AND_RLS_FIXES.sql` and inspect `information_schema.columns`.

---

## 9. Git & PR workflow (recommended)
1. Create a feature branch: `git checkout -b fix/chat-migrations-friend-picker`
2. Commit your changes with a descriptive message.
3. Push and open a PR with the checklist (include: SQL run, supabase envs set, mobile QA completed).

---

## 10. Contact / Support
If you hit any blockers, create an issue in this repository with reproduction steps and SQL errors/logs attached.

---

Thank you — this guide should get you and contributors from zero to a working deployment. If you'd like, I can add a small `scripts/` helper to inject environment variables at build time (Node script) and add CI instructions. Let me know.