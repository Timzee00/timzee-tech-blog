# Production Readiness

**Current status: code hardening is under review; readiness for millions of users has not been demonstrated.** Read [the 6 October 2026 review](docs/production-review-2026-10-06.md) for verified findings, fixes, deployment drift, and launch blockers. Older completion reports are historical, not evidence of current readiness.

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
- No production deployment or database migration is performed by the validation workflow.
