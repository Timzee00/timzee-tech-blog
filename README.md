# Blipmood

**Blipmood** is a community and social platform built by Timzee Corp. It brings together a personalised feed, profiles, messaging, communities, short-form video, stories, creator tools, a marketplace, moderation and an authenticated AI assistant.

The repository slug `timzee-tech-blog` is historical. The product name is **Blipmood**.

## Start here

| Goal | Read |
| --- | --- |
| Understand the system | [Architecture](docs/ARCHITECTURE.md) |
| Set up development | [Contributing](CONTRIBUTING.md) |
| Find current docs | [Documentation index](docs/DOCUMENTATION_INDEX.md) |
| Understand release gates | [Production readiness](PRODUCTION_READINESS.md) |
| Shared UI rules | [Design](DESIGN.md) and [UX contract](UX-CONTRACT.md) |

Old setup/completion reports remain under [docs/archive](docs/archive/README.md), for history only.

## Product areas

Feed and publishing; profiles, settings and verification; direct/group messaging; communities and moderation; videos and Stories; marketplace and rewards; creator tools and editorial curation; administration and analytics; authenticated AI.

Source code does not imply that a feature is enabled or deployed. Check its feature documentation and release gates.

## Technology

| Layer | Technology | Location |
| --- | --- | --- |
| Web client | Static HTML, CSS, browser ES modules | Root HTML, `assets/` |
| Build | Node 22, esbuild, project scripts | `scripts/`, `package.json` |
| Hosting/API | Netlify static site and Functions | `netlify.toml`, `netlify/functions/` |
| Data | Supabase Auth, Postgres, RLS, Storage, Realtime | `assets/js/supabase.js`, `supabase/migrations/` |
| Product email | Brevo server integration; Auth SMTP separate | `netlify/functions/email-worker.js` |
| Audio | LiveKit integration | `assets/js/live-spaces.mjs` |
| Public media cache | Cloudflare Workers Free; client route off by default | `cloudflare/`, `assets/js/media-delivery.mjs` |
| Quality | Node tests, validators, Playwright | `tests/`, `scripts/` |

See [Architecture](docs/ARCHITECTURE.md) for request flows and module boundaries.

## Local development

Requires Node **22.x**, npm, Git and Chromium for Playwright.

```bash
git clone https://github.com/Timzee00/timzee-tech-blog.git
cd timzee-tech-blog
npm ci --ignore-scripts
npm run check
npm test
npm run build
node scripts/serve-site.mjs
```

`npm run build` runs the configured checks and creates public `dist/` output. The local static server does not emulate Netlify Functions, Supabase Auth/RLS, Realtime, LiveKit or email delivery. Use isolated staging for service integration tests; do not run destructive/load tests against production.

### Browser tests

```bash
npx playwright install chromium
npm run test:browser
```

Browser fixtures and intercepted requests do not prove live database permissions, provider delivery or capacity.

### Cloudflare checks

```bash
npm run check:cloudflare-free
npm run check:cloudflare-media
```

These validate Worker code; they do not activate media routing.

## Environment and secrets

Depending on the feature, server-side functions use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, AI provider keys and Brevo transactional email settings. Inspect the specific handler and feature guide for exact variable names.

The browser uses only the Supabase publishable/anon key. **Never expose a service-role key, AI key, Brevo key, LiveKit secret or other server secret in browser code, committed files or client storage.** Supabase Auth confirmation/reset SMTP is configured separately in Supabase Auth; a Netlify Brevo variable does not configure it. See [Brevo + Supabase setup](docs/BREVO_SUPABASE_SETUP.md).

## Database rules

- New schema changes belong in `supabase/migrations/`.
- Compare the live catalog and applied migration ledger before adding schema references.
- `docs/sql/` contains review-only proposals.
- Root SQL files are historical snapshots, not a fresh-database baseline. Do not paste them into a live SQL editor as a setup shortcut.
- Never weaken RLS or authorize with browser-supplied role metadata.
- The migration history is incremental and does not guarantee fresh-project bootstrap by itself.

## Quality commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Ordered validators and focused regressions |
| `npm test` | All Node tests matching `tests/*.test.cjs` |
| `npm run test:browser` | Build and Playwright suite |
| `npm run build` | Checks and public build |
| `npm run check:cloudflare-free` | Workers Free tests |
| `npm run check:cloudflare-media` | Media Worker tests |

The check runner prints its stages and stops on the first failure. See [Contributing](CONTRIBUTING.md).

## Deployment safety

Netlify publishes `dist/` and serves Functions from `netlify/functions/`. A passing local build does not authorise a release. Read [Production Readiness](PRODUCTION_READINESS.md) and confirm the exact commit, hosted CI, isolated staging, schema compatibility, quotas, backup/restore, rollback and runtime health. Do not unlock a deliberately locked deploy or apply production migrations during routine code review.

## Capacity claims

A large codebase or passing local suite is not proof of readiness for millions of users. Capacity claims require representative staging data, measured load tests, observed infrastructure limits and an operating-cost model.

---

**Blipmood — Powered by Timzee Corp.**
