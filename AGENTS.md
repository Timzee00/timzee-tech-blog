# Blipmood engineering agent instructions

Work in the existing `main` branch; do not create a new branch unless explicitly requested. Keep the Netlify frontend, Supabase Auth/Postgres/RLS, Brevo email and LiveKit audio integration intact. Avoid surprises: no paid infra, destructive data changes, private media exposure or DB policy bypasses.

## Cloudflare integration

Follow Cloudflare's current agent setup documentation: <https://developers.cloudflare.com/agent-setup/> and the Cloudflare R2/Workers docs. Consult current docs and applicable project skills rather than treating old API shapes, limits or prices as authoritative.

- The new Cloudflare Worker is in `cloudflare/blipmood-media/`, with deployment configuration in `wrangler.jsonc`.
- Cloudflare R2 has NOT been activated yet. Never claim it is live until the Cloudflare API confirms a bucket and the Worker is deployed and tested.
- `assets/js/media-delivery.mjs` is the deliberately **disabled** read-only URL routing switch. Keep it disabled until tests, storage activation, deletion invalidation and a production deployment all pass.
- New public videos and Stories still use Supabase upload and ownership validation. Private chat, member-only community media and expiring Stories must never be mirrored into public R2.
- Do not weaken `platform_video_upload_gate`, `publish_story`, ownership checks or RLS to make R2 uploads work.
- R2 may bill for storage and requests above free allowance, even though R2 does not charge for egress. Never silently upgrade or enable billable subscriptions.
- Validate via `npm run check:cloudflare-media`, then full `npm run check` and mobile browser smoke tests before activating traffic.

Current status, activation instructions, rollout and rollback are in `cloudflare/blipmood-media/README.md`.

A separate **Workers Free** media cache (no R2) is deployed at `cloudflare/blipmood-free-cache/`. `assets/js/media-delivery.mjs` is OFF by default and may be tried in a single browser with `?blipmood_cache_canary=1` after the Netlify production lock is lifted. Never globally enable it without live response, range, quota and deletion tests.


## Database and RLS compatibility

These rules follow actual production failures found in November 2026:
- Before adding a Supabase table/RPC/column reference, compare it with the live catalog and relevant applied migrations. Record any new schema in a versioned migration rather than silently changing only the live project.
- A public table may allow anonymous INSERT but deny SELECT (for example, `content_requests`). Never use `.insert(...).select().single()` or SQL `INSERT ... RETURNING` on a write-only public form: PostgreSQL can return RLS `42501` even when the INSERT without returning succeeds. Keep the saved ID client-generated when needed.
- When one trigger function is attached to different tables, put `OLD.foo`/`NEW.foo` references inside **separate nested table-specific IF branches**. Do not combine `TG_TABLE_NAME = 'x' AND OLD.x_only_column ...` in one boolean condition: PostgreSQL can resolve the wrong table's record fields and raise `42703`.
- Supabase may grant function EXECUTE directly to `anon`, even after `REVOKE ... FROM PUBLIC`. For sensitive `SECURITY DEFINER` functions, explicitly revoke from `PUBLIC, anon` and only grant the specific intended role. Never blindly revoke from shared functions used inside RLS.
- Do not change, weaken or remove RLS policies merely to hide permission errors. Prove authorized and unauthorized behavior using an authenticated-role transaction and `ROLLBACK`, with no persisted test rows.
- Database and application releases must agree: `npm run check` includes `tests/blipmood-db-contracts.test.cjs`; run role-based database tests and browser smoke tests before claiming production-safe. Fix Netlify's locked deployment before expecting new JS to reach visitors.
- Keep optional feed-refresh functionality off until its reviewed RPC, performance tests and security checks are complete. Do not enable billing or remove existing media as a workaround.

See `docs/audits/2026-11-03-database-rls-stability.md` for the tested incident and rollout status.
