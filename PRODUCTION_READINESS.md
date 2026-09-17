# Production Readiness

This document is the canonical production checklist for Timzee Tech Blog.

## Release source of truth

- GitHub `main` is the source branch.
- Netlify production must deploy from the current `main` commit.
- Never treat older status/report documents as proof that production is current.

## Required production controls

- Security headers are managed in `netlify.toml`.
- Provider API keys are server-side only.
- LLM requests are authenticated, rate-limited, and bounded by request/token limits.
- Privileged moderation mutations return database errors rather than false success responses.
- Supabase schema changes are tracked in `supabase/migrations`.
- Foreign-key indexes are added where the Supabase advisor identifies missing coverage.
- Unused indexes are reviewed using real workload data before removal; an unused-index warning alone is not a safe reason to drop an index.
- RLS policy consolidation must preserve the existing authorization model and should be performed in small, verified migrations.
- Leaked-password protection is enabled in Supabase Auth settings on plans that support it.
- Production backups, restore testing, and alerting remain operational responsibilities outside the static site bundle.

## Verification after release

1. Confirm the Netlify production deploy commit equals GitHub `main`.
2. Run the public smoke-test URLs.
3. Run authenticated E2E browser tests where credentials are available.
4. Run Supabase security and performance advisors after schema changes.
5. Review function logs for failed LLM/moderation requests.
