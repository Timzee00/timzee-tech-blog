# Production Readiness

**Current status: code hardening is under review; readiness for millions of users has not been demonstrated.** Read [the 8 October sitewide review](docs/sitewide-review-2026-10-08.md) for the redesign, repairs, test evidence and current launch blockers, alongside [the initial production assessment](docs/production-review-2026-10-06.md). Older completion reports are historical, not evidence of current readiness.

The [chat reliability follow-up](docs/chat-reliability-review-2026-10-08.md) covers conversation races, draft retention, subscription recovery, people discovery, unread counts, and the remaining chat scaling limits.

The [9 October follow-up](docs/media-actions-review-2026-10-09.md) adds bounded private-media signing, accessible message actions and a private, single-use handoff to the assistant.

GitHub Actions currently cannot start a runner because the account is locked for billing (confirmed 8 October 2026). Local checks pass; rerun the hosted gate after resolving that account block. Netlify production remains deliberately locked.

## Release gates

1. Use Node 22 and `npm ci --ignore-scripts`.
2. Run `npm run build`, `npm test`, and `npm audit --omit=dev --audit-level=high`.
3. Install Chromium with `npx playwright install --with-deps chromium`, then run `npx playwright test`.
4. Exercise authenticated multi-user workflows against an isolated staging backend. Local browser fixtures do not validate live RLS or external services.
5. Reconcile the actual Supabase schema and migration ledger; run security/performance advisors. The tracked SQL files are incremental patches and do not provision a new environment alone.
6. Complete the agreed capacity, backup/restore, rollback and monitoring checks in the review.
7. Review and approve the exact release commit before replacing the locked production deployment. Publish `dist/` with Netlify Functions. Verify `/release.json` matches the intended commit and `/health` is healthy.

## Deployment controls

- `netlify.toml` runs the build and publishes only `dist/`; `_headers` manages static security/cache headers. Functions set response headers themselves.
- Browser JavaScript/CSS references carry a content version to invalidate the former one-year immutable cache. Stable filenames revalidate. Supabase and DOMPurify are bundled from the lockfile.
- `/release.json` contains build-time commit metadata; runtime platform environment variables may not be present in Functions.
- Server credentials and provider secrets stay in the hosting environment. The browser publishable key is public by design; database grants/RLS enforce access.
- Privileged endpoint access requires an existing active profile with the correct current role. Role/profile synchronization failures must be repaired rather than treated as success.
- A preview currently uses the hardcoded production backend unless its frontend configuration is explicitly changed for staging. Do not run mutating E2E/load tests against it by default.
- Recurring maintenance invokes the automation RPC only. Automatic legacy-media migration and deletion were removed because partial reference scans cannot establish safe deletion. Old public chat media still needs a separately validated migration.
- Netlify runs an explicit ignore command for commit subjects containing `[skip netlify]`. Git builds stop before dependency installation; build hooks can bypass this command. The initial review push still produced an automatic preview despite its marker, so do not treat production locking alone as a preview-spend limit.
- No production deployment or database migration is performed by the validation workflow.
