# Documentation index

Use this index for current instructions. The legacy reports under `docs/archive/legacy-guides/` are retained for history, not current setup/release guidance.

## Start here

| Document | Purpose |
| --- | --- |
| [README](../README.md) | Product, stack, setup and commands |
| [Architecture](ARCHITECTURE.md) | System map, boundaries and feature tracing |
| [Contributing](../CONTRIBUTING.md) | Code, security, testing and review |
| [Agent instructions](../AGENTS.md) | Repository-specific constraints |
| [Production readiness](../PRODUCTION_READINESS.md) | Release gates and operational blockers |
| [Design](../DESIGN.md) and [UX contract](../UX-CONTRACT.md) | Shared visual and interaction rules |

## Current technical references

- Migration history: `supabase/migrations/`
- Review-only SQL: `docs/sql/`
- [Brevo and Supabase Auth email](BREVO_SUPABASE_SETUP.md)
- [Community forum architecture](COMMUNITY_FORUM_ARCHITECTURE.md)
- [Scale-readiness checkpoint](SCALING_TO_100K.md)
- [Database/RLS stability audit](audits/2026-11-03-database-rls-stability.md)
- Worker setup/status: `cloudflare/*/README.md`
- Build and validation: `scripts/` and `package.json`
- Node/browser tests: `tests/` and `tests/browser/`

Feature/release notes describe implementation at a particular revision; they do not prove deployment. Confirm deployed SHA separately.

## Historical archive

[Archive guide](archive/README.md) explains superseded reports and one-off SQL snapshots. Do not use their SQL, deployment commands or status claims to provision/release the current platform.
