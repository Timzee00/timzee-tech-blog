# Blipmood guidance for coding assistants

Read `AGENTS.md`, `README.md`, `CONTRIBUTING.md` and `docs/ARCHITECTURE.md` before cross-cutting work. Use `docs/DOCUMENTATION_INDEX.md` for current feature notes. `docs/archive/legacy-guides/` contains superseded records, not current setup/security guidance.

## Product and architecture

- Product: **Blipmood**. The `timzee-tech-blog` slug is historical.
- Frontend: root static HTML, CSS in `assets/css/`, browser ES modules in `assets/js/`.
- Build: Node 22; `scripts/build-site.mjs` creates `dist/`.
- Hosting/API: Netlify static hosting and handlers in `netlify/functions/`; shared helpers in `netlify/functions/_lib/`.
- Data: Supabase Auth, Postgres, RLS, Storage and Realtime. Canonical schema changes are in `supabase/migrations/`.
- Integrations include Brevo product email, LiveKit audio spaces and separate Cloudflare Workers; consult their feature docs for status.
- Preserve this architecture; do not introduce a framework as a readability shortcut.

## Safe implementation

- Search existing modules, Functions, RPCs, migrations and tests before adding another implementation.
- Trace route → browser module → request → authorization → persistence/provider → UI state.
- Browser code uses only the Supabase publishable/anon key. Service-role and provider secrets stay server-side.
- Authorization uses trusted `app_metadata` and/or DB role mappings plus RLS. Never trust `user_metadata.role`, URLs or hidden controls.
- Never weaken RLS. Keep private chat, restricted-community media and expiring Stories private.
- New schema belongs in timestamped `supabase/migrations/` files. Root SQL is historical; `docs/sql/` is review-only.
- Use `textContent` for plain text; escape/sanitize untrusted HTML.
- Extract pure helpers from large controllers before stateful splits; test the helper contract.
- Use shared SVG icons, not emoji icons.

## Commands

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run check` is orchestrated by `scripts/run-checks.mjs`; `npm test` runs Node tests; `npm run test:browser` runs Playwright after build. Mocks do not prove production integration.

## Release constraints

Read `PRODUCTION_READINESS.md`. Local success does not prove hosted CI, deployed behavior, live RLS or capacity. Do not unlock/deploy Netlify, apply production migrations, change billing, expose secrets or enable global media routing without approval and release gates.
