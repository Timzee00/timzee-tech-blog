# Product Council — implementation and safe release notes

## Scope
Feature branch `blipmood-council-enhancements`. Built as an additive layer on existing identity appointments, Blipmood profile badges, and the public affiliation cache. No existing roles are removed; no identity record is rewritten or backfilled.

## Workspaces
- `product-council.html`: public overview, authenticated role-gated workspace, roadmap, ideas, bug triage, feedback, research, meetings, missions, release recommendations, beta invitations, votes and commentary.
- `assets/js/product-council.mjs`: bounded data access, text-only rendering, role checks on load, guarded insert/update actions, public credits.
- `assets/css/product-council.css`: accessible standalone responsive style.
- `super/identity-recognition.html`: existing super-admin appointment picker extended with Product Manager, Beta Tester, Research/Design Contributor and Launch Reviewer.
- `assets/js/profile.js`: existing account transparency supports the added appointment names.

## Official Blipmood affiliation badge — use the ORIGINAL artwork
The site's real emblem is already checksum-verified during builds and published at `/assets/brand/blipmood-emblem-light.png`. We intentionally do not create a lookalike logo.

To grant an official Blipmood affiliation:
1. Super Admin registers the actual Blipmood organization under Identity & Recognition, with the approved Blipmood account and `https://blipmood.netlify.app/assets/brand/blipmood-emblem-light.png` as logo.
2. Super Admin verifies that organization using real evidence and an audited reason. **Do not verify an unrelated or impersonating organization.**
3. Super Admin invites the appointed member via the existing **Invite company affiliate** form, specifying their official position.
4. The member accepts from the profile's account transparency panel. The existing `primary_org_*` cache adds the official logo beside public usernames across feed, comments, chats and profile renderers.
5. Revocation removes the affiliation using the existing audited workflow. The public identity cache refreshes from the existing trigger, with frontend caching expiring within 60 seconds.

Note: New Council appointments alone never create affiliation, verification, moderator privileges or automatic account recommendations.

## Database migration
`20261030014000_blipmood_product_council_foundation.sql`:
- Adds five RLS-protected public relations: items, comments, votes, beta invitations and credits.
- Adds immutable provenance guards and private audit trails.
- Reuses the existing four Council appointment types and adds five new approved appointment types.
- Product Managers cannot finalize approvals/releases; only Product Leads or Super Admin can.
- No runtime feature flags are changed; a release review is a **recommendation**, never an actual deployment.

## Operational caveats
This is the Council foundation, not a substitute for code deployment, an experiment service, or an automated release pipeline. Actual beta feature rollout, analytics exports and automatic issue-to-GitHub sync require separate integrations and validation. No private messages, user secrets, identity evidence or unrestricted administrator rights are exposed.

## Release gate
1. Run `npm run check`, `npm test`, `npm run build` on the proposed branch and inspect GitHub CI.
2. On a staging or rollback-safe target, apply the migration **once** in order and verify the version appears in `supabase_migrations.schema_migrations`. Do not manually replay this migration if already applied.
3. Test an unappointed account, each Council role, revoked/expired roles, Product Manager boundaries, and Super Admin. Confirm anonymous users only see published credits.
4. Confirm no non-super user can appoint themselves or publish a fake official affiliation.
5. Exercise propose → triage → assign → discuss → beta invite → accept/decline → credit and revoke. Check no error entries in Postgres security/performance advisors.
6. Verify actual Blipmood logo and name display on phone/desktop and light/dark mode.
7. Publish only after the preview and complete smoke test pass. The previous project's Netlify/GitHub CI restrictions may still require attention.

## Rollback
Frontend: switch back to the previous Netlify deployment without changing identity data. Tables are additive and harmless when unused. Do not drop relations or erase member contributions as a quick rollback. For database defects, release a targeted forward-fix migration after making a safe backup.
