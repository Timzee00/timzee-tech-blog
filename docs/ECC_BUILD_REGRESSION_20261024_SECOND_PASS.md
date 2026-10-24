# ECC / Code Assistant / Vibe Coder — Netlify build test regression

Date: 2026-10-24 (Africa/Lagos)
Repository: Timzee00/timzee-tech-blog
Base: `9c263602c6f22a5e5485c964cc7a3cedaae281c3`
Branch: `main`
Reported Netlify deploy: `6adc4c13fcaf7f361132870e` (production)
Build: `npm run build` → `npm run check`

## Root causes

The first test batch passed all 24 checks. The next batch had 79 passing
and 7 failing tests; this halted the build before the static site compiler.

| Test | Diagnosis | Repair |
| --- | --- | --- |
| community-ranking-v2 | References missing SQL filename `20261017020000_auto_moderation_queue.sql` | Read existing `20261017020500_auto_moderation_queue.sql`, preserving staff RLS, reviewer RPC and signal assertions |
| founder-operations-digest | Expects `data.path`, while checkbox uses DOM `input.dataset.path` | Test the actual super-admin-only checkbox construction |
| operations-inbox | Three literal regular expressions overescape their dots, producing false failures | Correct regex escaping; retain checks for confirmation, integer IDs, audited RPCs, secure rendering |
| reader-interest-ranker | Test presumes preference order wins on equal scores; code sorts equal scores by publish recency | Assert the documented deterministic newest-first tie-break for equally scored published articles |
| reader-retention | Assert uses capitalized `Sign in` but valid error says `Please sign in first.` | Match the same error case-insensitively; account-scoped deletion assertions remain |
| settings-center | Looks for two literal `from("...")` calls; actual code iterates a fixed allowlist | Assert exact allowlist and `.delete().eq("user_id",uid)` boundary |
| verification-frame-collection | Expects direct assignment from provider; current code hydrates to local `identities` first | Assert provider hydration + explicit map assignment; retain trusted verification checks |

## Evidence and release gates

- PASS: 7 modified test files parsed as JavaScript.
- PASS: each changed regex/path expectation was cross-checked against the
  actual current repository SQL or JS source.
- PASS: direct V8 execution of `recommendForInterests` with committed test
  fixture returned published ID 3 followed by ID 1.
- PASS: statically enumerated all 36 tests configured in `npm run check`
  and checked literal repository-file references across all 36; the
  only missing file reference found was the resolved auto-moderation migration.
- NOT RUN: native Node 22 tests, full `npm run build`, real provider
  integration, and production deploy. Network-isolated container cannot clone
  the repository, and no Netlify build was triggered.
- Residual: Netlify reported one critical dependency advisory; independent
  `npm audit --omit=dev` and dependency review are still necessary.
- Scope: test assertions and documentation only. No app logic changes,
  SQL migrations, Netlify settings, or production data changes.

## Reproduce on a trusted checkout

```sh
npm ci --ignore-scripts
node --test tests/community-ranking-v2.test.cjs tests/founder-operations-digest.test.cjs tests/operations-inbox.test.cjs tests/reader-interest-ranker.test.cjs tests/reader-retention.test.cjs tests/settings-center.test.cjs tests/verification-frame-collection.test.cjs
npm run check
npm run build
npm audit --omit=dev
```

Use the current `main` SHA, not an old pull request reference. Avoid
`npm audit fix --force` without reviewing the update, and avoid spending
build credits on the same unverified revision.

## Rollback

If this test-only commit needs reverting, make a normal revert commit on
`main` (no force push). Do not roll back live schema or RLS to satisfy a
test expectation.
