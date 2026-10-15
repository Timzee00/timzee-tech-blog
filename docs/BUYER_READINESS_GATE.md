# Buyer-readiness and acquisition due-diligence gate

**As of 2026-10-11 · Status: NOT CERTIFIED / NOT FOR PRODUCTION PROMOTION**

This evidence file is for a prospective technical buyer's review. It is **not** an official TikTok standard, an assertion that TikTok has made an offer, an audit certificate, or a guarantee of error-free operation. Obtain the buyer's written technical requirements and commercial terms separately.

## Engineering baseline and known deployments

- Repository: `Timzee00/timzee-tech-blog`.
- Primary Codex redesign: draft PR #3, `codex/production-readiness`.
- Follow-up corrections: draft PR #4, `fix/sitewide-shell-20261010`, targeting Codex's branch. Neither PR is merged into `main`.
- Production: https://timzee-tech-blog.netlify.app/ (older locked release).
- Existing public preview #3: https://deploy-preview-3--timzee-tech-blog.netlify.app/ (older preview, **not** PR #4's new work).
- The preview still points to the live Supabase project, so it is **not isolated staging**. Do not run destructive or privileged tests there.
- Read-only checks on 2026-10-11: both `/health` endpoints returned 200 with healthy backend indicators, but exposed `version: unknown` and no deploy ID. A healthy status response alone does not prove release provenance.
- Observed mobile blockers on the published site: welcome modal and competing announcement/cookie overlays obscure content. In the existing preview, some image elements fail. These findings do not confirm failures on the **unbuilt** PR #4 branch.

## Buyer technical acceptance matrix

| Area | Acceptance evidence required | Current state |
| --- | --- | --- |
| Design | Consistent desktop/tablet/320–390px mobile UX, light/dark contrast, responsive controls, clear loading/error/empty states, no broken images | Redesign underway; latest branch unbuilt |
| Authentication | Separate-user login/logout, email confirmation, recovery, Google/Apple OAuth, account suspension, redirects to correct origin and admin-role boundaries | Redirect/race source fixes committed; live flows unverified |
| Publishing/social | Post authoring, editing, media, feeds, comments, reactions, following, discussion, reporting and moderation | Mock browser coverage from Codex; live multi-role tests pending |
| Messaging | Two-account delivery/reconnect, groups, voice, attachment renewal, signed media, blocked users, membership changes and replay | Durable attachment path fix; end-to-end tests pending |
| Stories/video/novels | Upload, playback, creation, editing, takedown and quotas on phone/desktop | Pending |
| Marketplace | Create/edit/listing lifecycle, multi-currency pricing, inquiries, seller contact, reporting and inventory status | Currency repair in PR #4; real two-account tests pending |
| Admin/AI | Role checks, staff moderation, denied actions, provider timeouts, rate limits, no client-side secret keys, audit events | Pending live authorization and provider checks |
| Accessibility | WCAG 2.2 AA audit, including keyboard, focus, screen readers, labels and contrast | Partial automated axe checks; full audit pending |
| Performance | Google Core Web Vitals at p75: LCP <=2.5s, INP <=200ms, CLS <=0.1; device/network segments and real field data | Not measured for new branch |
| Security | OWASP ASVS 5.0-aligned review, account/session/RLS tests, signed media access, file upload controls, CSP, abuse limits, dependency scan | Source controls exist; independent security verification pending |
| Reliability | Staging/production isolation, logged operational errors, uptime, background job reporting, backup/restore rehearsal, rollback, predictable build/release | Pending |
| SEO and release | Correct production canonical and robots; preview noindex; exact commit verified by `release.json`; sitemap and social previews | Preview noindex and release verifier committed, not deployed |

## Highest-priority documented blockers

1. **No isolated staging backend.** Existing Netlify preview uses production Supabase. Create a separate project with sanitized seeded accounts and data before testing auth, roles, deletes and realtime groups.
2. **Historical public chat media.** A read-only inventory found 11 objects in `media/direct-messages/`. Two public Storage INSERT policies continue permitting that prefix. Prohibit new public chat uploads in a reviewed migration and inventory all references *before* moving or deleting older objects. Never infer orphan status only from a zero count for one URL pattern.
3. **Live Supabase Auth advisory.** Leaked-password protection is disabled. Enable via the Supabase Auth configuration after evaluating plan/availability; verify with the security adviser. Documentation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
4. **Intentionally private operational table.** `public.system_job_status` has RLS but no policies. Verify only service-level access; do not add anonymous read rules to silence the advisory.
5. **Hosted validation.** GitHub Actions previously declined to start due to account billing. A successful local test cannot replace a reproducible hosted CI run. Avoid accidental Netlify builds while credits are constrained.
6. **No current code-level release proof.** The public health endpoint may report a healthy old release. Verify `release.json` exactly matches the commit being reviewed and reproduce E2E test evidence against that release.
7. **Privacy and intellectual property.** Before any transfer, inventory code contributors and IP assignments, third-party SDK/API licenses, images and user-generated content rights, data-processing agreements, Nigerian privacy compliance and any applicable international transfer conditions. Consult qualified counsel; technical changes alone do not establish sale readiness.

## Repeatable public release smoke gate

Once an **isolated, deliberately deployed** preview exists:

```sh
node scripts/verify-public-release.mjs https://your-preview.example <expected-40-character-commit-sha>
```

This read-only verifier checks nine public HTML routes, `/health`, release provenance, and Netlify preview noindex/robots protections. It does not log in, create users, upload media, or run destructive tests. The site also needs authenticated and browser accessibility/performance suites against staging.

## Exit condition

Do not label the site "buyer ready", "enterprise certified", "perfect" or "production approved" until the checks above are evidenced on an identical deployed commit, independent authorized roles and real-user journeys have passed, security/privacy/legal findings are dispositioned, and operations have signed off on backups, monitoring and rollback. Preserve raw evidence, test scripts, migration logs, license inventory and repository history for buyer review.
