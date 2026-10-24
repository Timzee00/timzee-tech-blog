# ECC build incident: stale My Tech and forum tests

Date: 2026-10-24 (Africa/Lagos)
Repository: Timzee00/timzee-tech-blog
Fixed branch: main
Baseline head: 41ccc3c26273c7d2c6104372c780744450e63d97
Provider deployment: NOT RUN

## Netlify log and reproduction

Failed Netlify build ID: `6adc49fa503904cbef03d1ed`
Deploy ID: `6adc49fa503904cbef03d1ef`
Build context: `deploy-preview`; Git reference `pull/7/head`.
PR #7 was **merged and closed on 2026-10-21**. Rebuilding that historic
revision is not equivalent to building current `main`.

At 7:03 AM the reported run executed `npm run build` and reached
`node --test tests/production-media-smoke.test.cjs
tests/community-forums.test.cjs tests/community-expansion.test.cjs`.
Result: **22 passed, 2 failed**. JavaScript syntax and link validation passed.

1. `tests/community-expansion.test.cjs` referred to missing migration
   `20261017031000_my_tech_five_story_brief.sql`. Current original filename
   is `20261017031500_my_tech_five_story_brief.sql`.
   It additionally expected the old, unsafe NULL-status-as-published predicate.
   The later migration
   `20261023111914_restrict_my_tech_brief_to_explicit_published_articles.sql`
   deliberately replaces that predicate with `p.status='published'`.
   The corrected test validates both the original briefing creation and
   the later secure published-only rule, publish-time restriction and 5-story cap.
2. `tests/community-forums.test.cjs` required the obsolete
   `mediaHtml(url,type)` declaration. The client now accepts optional
   private-media context arguments. The corrected test checks the current
   declaration, private-media signing placeholder and URL validation without
   editing production media logic.

## Verification

- **PASS / baseline RED reproduction:** Both original tests failed when
  evaluated against the current committed SQL and JavaScript fixtures.
- **PASS / patched GREEN reproduction:** Both corrected tests passed in the
  V8 test harness using actual repository source and migration contents.
- **PASS / syntax:** Both revised test files parsed without syntax errors.
- **NOT RUN:** Native Node 22 test suite, full `npm run build`,
  browser tests and a Netlify rebuild (no isolated full repository checkout
  or deployment performed).
- **No production data/schema changes:** This patch updates tests and
  documentation only.
- **Dependency warning:** Netlify also reported one critical npm audit
  vulnerability. This is a separate issue and was not automatically
  addressed by `npm audit fix --force`.

## Safest next build

Checkout current `main` (not the merged PR #7 reference) and run:

```sh
npm ci --ignore-scripts
node --test tests/production-media-smoke.test.cjs tests/community-forums.test.cjs tests/community-expansion.test.cjs
npm run build
npm audit --omit=dev
```

Releasing remains blocked until the full build passes. Do not assume a
historic PR preview updates when a new commit lands on `main`.
For rollback, use a normal revert of this single commit; do not rewrite
migration history or force-push.
