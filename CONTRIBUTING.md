# Contributing to Blipmood

Read [Architecture](docs/ARCHITECTURE.md) before cross-layer changes.

## Before editing

1. Read `AGENTS.md`, this guide and the current feature/release note.
2. Confirm the current `main` revision; inspect related pages, imports, Functions, migrations and tests.
3. Trace route → request → authorization → persistence/provider → visible result.
4. Search for existing implementations before adding another module, endpoint, RPC or schema object.

The repository instructions require work on existing `main` unless another branch is explicitly requested.

## Code organisation

- Preserve static HTML/CSS/browser ES modules. Do not add a frontend framework as a readability shortcut.
- Keep modules cohesive with one responsibility and explicit imports/exports.
- Keep page controllers focused on orchestration. Extract pure formatting, parsing and validation helpers into testable modules.
- Do not split files only to meet a line-count target. Identify a cohesive unit and preserve its contract.
- Use descriptive kebab-case names and follow adjacent extension conventions.
- Follow local style: semicolons, consistent indentation, descriptive names and explicit early returns. Comments explain non-obvious invariants.
- Use `textContent` for plain text. Escape/sanitize untrusted values when rendering HTML.
- Use the shared SVG icon system, not emoji icons.

## Security and data

- Authorization uses trusted `app_metadata`, database role mappings, server checks and Postgres RLS. Never trust `user_metadata.role`, query parameters, hidden UI or browser-supplied roles.
- Supabase service-role and third-party provider secrets belong only in server-side environment variables.
- Keep private media private; verify ownership, signing lifetime and Storage policies.
- New schema changes belong in timestamped `supabase/migrations/` files. Check the actual catalog and applied migration ledger first.
- `docs/sql/` files are review-only proposals; root SQL snapshots are historical. Do not execute these as bootstrap scripts or production migrations.
- Never weaken RLS to hide permission errors. Test allowed and denied identities in isolated staging.
- Make retryable browser, scheduler and webhook actions idempotent.

## Validation

```bash
npm ci --ignore-scripts
node --test tests/<related-test>.test.cjs
npm run check
npm test
npm run build
```

For visible route, interaction or responsive changes:

```bash
npx playwright install chromium
npm run test:browser
```

For Cloudflare changes run the matching `npm run check:cloudflare-*` command. `npm run check` is orchestrated by `scripts/run-checks.mjs`; `npm test` runs all Node tests. Mocks do not prove live RLS, Auth SMTP, LiveKit, provider delivery or capacity. Use isolated staging for service tests.

## Review checklist

- [ ] Related routes, callers and alternate implementations inspected.
- [ ] Authorization enforced at server/database boundary.
- [ ] Loading, empty, success, failure and retry states covered where relevant.
- [ ] Schema changes versioned, additive and tested in staging.
- [ ] Focused regression tests added/updated.
- [ ] Relevant check, Node and browser tests executed.
- [ ] Responsive/accessibility checks run for UI changes.
- [ ] No secrets, customer data or private media added.
- [ ] Release notes and [production gates](PRODUCTION_READINESS.md) match verified behavior.

## Release safety

Code changes, migrations, provider settings and deployment are separate operations. A local build does not authorise a release. Do not unlock Netlify, change billing, rotate production secrets, apply production migrations or enable disabled media routing as routine maintenance.
