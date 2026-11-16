# Blipmood engineering instructions

Work on existing `main` unless the user explicitly requests another branch. Keep changes small and reviewable. Preserve the static HTML/CSS/browser-ESM frontend, Netlify Functions, Supabase Auth/Postgres/RLS, Brevo product email and LiveKit audio integrations. Avoid paid infrastructure, destructive data changes, private-media exposure and RLS bypasses.

## Read first

- `README.md` — product and developer entry point.
- `docs/ARCHITECTURE.md` — repository map and request paths.
- `CONTRIBUTING.md` — code, security and test standards.
- `docs/DOCUMENTATION_INDEX.md` — current feature documents.
- `PRODUCTION_READINESS.md` — release gates.

`docs/archive/legacy-guides/` contains historical snapshots. Do not follow its old SQL, setup commands, feature statuses or security recommendations as current guidance.

## Architecture

- Product name is **Blipmood**; `timzee-tech-blog` is a legacy repo slug.
- Root HTML files are entry points; browser modules are in `assets/js/`; CSS is in `assets/css/`.
- `scripts/build-site.mjs` creates `dist/`; Netlify publishes `dist/` and serves `netlify/functions/`.
- Supabase provides Auth, Postgres, RLS, Storage and Realtime.
- Cloudflare Workers are separate projects; public media client routing is disabled by default.

## Workflow

1. Inspect current `main`, related entry points, imports, Functions, migrations and tests.
2. Search for existing implementations before adding code.
3. Trace UI event → request → authorization → persistence/provider → visible state.
4. Preserve contracts, RLS, private-media boundaries and free-tier constraints.
5. Add focused regression tests.
6. Run focused checks plus `npm run check` and relevant broader Node/browser tests.
7. Review final changes and report real results. Mocks do not prove live integration or capacity.

## Code rules

- Keep modules cohesive. Extract pure helpers before splitting stateful controllers.
- Do not refactor solely to meet line counts; preserve shared state and event wiring.
- Use descriptive kebab-case names and adjacent module conventions.
- Use `textContent` for plain user text; escape/sanitize untrusted HTML.
- Use shared SVG icons, not emoji icons.
- Comments explain invariants, not every line.

## Database, authorization and secrets

- New schema belongs in timestamped `supabase/migrations/` files. Root SQL files are historical; `docs/sql/` is review-only. Neither is a live migration command.
- Check actual schema and applied migration ledger first; migration history is incremental, not a guaranteed fresh-project bootstrap.
- Authorization uses trusted `app_metadata` and/or database-backed mappings. Never trust `user_metadata.role` or browser role values.
- Never expose Supabase service-role, AI provider, Brevo or other secrets in browser code or client storage.
- Never weaken RLS to hide permission errors.
- Private chat, member-only community media and expiring Stories must not be mirrored into public cache.

## Cloudflare

- Workers Free cache: `cloudflare/blipmood-free-cache/`; Media Worker: `cloudflare/blipmood-media/`.
- Their READMEs describe state and rollout gates. Do not enable R2, paid infrastructure or global routing without explicit approval and tests.
- Run relevant Worker checks and project checks after changes.

## Database/RLS compatibility

- Compare live schema and migrations before adding references; track every change in a versioned migration.
- Public tables may permit INSERT but deny SELECT; avoid `.insert().select().single()` for write-only submissions.
- Multi-table triggers must access table-specific `OLD`/`NEW` fields only within separate table branches.
- Revoke `PUBLIC, anon` from sensitive `SECURITY DEFINER` functions and grant only intended roles.
- Keep optional feed refresh disabled until its RPC, performance and security checks are complete.

## Verification

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Mocks do not replace staging checks for RLS, Auth SMTP, LiveKit, provider delivery or throughput.

## Deployment safety

Do not unlock Netlify production, run production migrations, change billing, rotate live secrets, enable media routing or publish a release during ordinary maintenance. Follow `PRODUCTION_READINESS.md` and obtain applicable approval.
