# Blipmood production database and RLS stability repair

**Date:** 2026-11-03 (Africa/Lagos)  
**Project:** `duvbcwwprkzzyzikmcol`  
**Repository:** `Timzee00/timzee-tech-blog`, existing `main` branch

## Summary

This repair addressed **proven** Postgres/PostgREST contract problems. It does not certify the entire site as free from untested runtime errors. New Supabase migrations are already applied to the live database; new JavaScript and tests are on GitHub `main` but are **not live** while Netlify production remains locked to an older deployment.

The production database has 140+ public tables. A previous static scan covered 193 JavaScript/serverless files and 57 HTML pages. Public tables had RLS enabled. However, schema shape alone did not catch a cross-table trigger bug or the INSERT/RETURNING RLS mismatch.

## Confirmed fixes with evidence

| Finding | Repair | Verification |
| --- | --- | --- |
| Admin user-list fallback queried nonexistent `profiles.status` | `super/professional-panel.html` now selects and displays `account_status` | Checked live columns and source contract |
| Admin restriction endpoint expected missing `account_restrictions` | Added restricted tables, owner-readable appeals, service-role-only writes, seven additive **RESTRICTIVE** content INSERT policies | Live catalog + privileges, active restriction scope checks in rolled-back transaction |
| Supabase default direct `anon` EXECUTE on `account_can_perform` | Explicitly revoked anonymous EXECUTE; kept authenticated EXECUTE for existing RLS | Live ACL: `anon_execute=false`, `member_execute=true` |
| Optional chat-preview RPC missing | Created indexed-friendly `get_direct_message_previews(text[])` with **SECURITY INVOKER** and no anonymous EXECUTE | Actual message sender can read their preview; unrelated authenticated identity sees none |
| Updating an organization failed Postgres `42703: record "old" has no field "workspace_id"` | `private.team_immutable_fields` now accesses OLD/NEW fields only inside the matching table-specific IF branch | Organization owner and project owner successfully INSERT, UPDATE and SELECT in transaction; all rolled back |
| Public topic-request insert returned `42501` | `assets/js/data.js` no longer calls `.select().single()` after anonymous form INSERT | Direct anonymous INSERT worked, INSERT RETURNING reproduced 42501, now removed from client |
| New restriction-table foreign keys not covered by indexes | Added four indexes to their FK columns | Supabase unindexed-FK advisor returned to earlier baseline of 58 |

### Applied migration history (exact versions)

- `20261103051817_enable_audited_staff_account_restrictions.sql`
- `20261103051917_restrict_account_can_perform_rpc_to_authenticated_only.sql`
- `20261103052153_install_rls_safe_batched_chat_previews.sql`
- `20261103052612_fix_shared_team_immutable_trigger_record_fields.sql`
- `20261103053904_index_new_account_restriction_foreign_keys.sql`

The database's PostgREST schema cache was signaled to refresh after applying migrations.

## Role and regression tests

**Completed against live PostgreSQL (using explicit transactions and ROLLBACK):**
- An authenticated account with a temporary posting restriction could not post, while unrelated comments and messages remained allowed.
- An authenticated organization owner could insert, update and read a new workspace.
- An authenticated creator-team owner could insert, update and read a team-studio project.
- An actual DM sender could read their thread's latest preview; an unrelated authenticated identity could not.
- Anonymous form INSERT succeeded; INSERT RETURNING was correctly denied by the admin-only SELECT RLS policy.
- 22 representative authenticated read queries on core platform tables completed without a SQL/RLS exception.
- A simulated super admin passed the privileged role check; a normal user could not read the admin content request queue.
- No durable test restrictions, workspaces, projects or content requests remained.

**Automated source tests:** `tests/blipmood-db-contracts.test.cjs` contains nine regression cases, all passed in an isolated JavaScript test harness. It is wired into the standard `npm run check` command along with the existing account-restriction and chat-preview tests. The full repository build and browser suite were **not** run successfully in this session (GitHub Production gate failures and unavailable GitHub checkout access).

**Future engineering instructions:** `AGENTS.md` now documents two critical lessons:
1. Never dereference columns of multiple trigger tables in the same boolean condition with `TG_TABLE_NAME`.
2. Never use `INSERT ... RETURNING` from a public form whose SELECT policy is admin-only.

## Known open risks and release blockers

1. **Netlify production still locked** at October 31 commit `982f200...`, so the new frontend fixes will not reach visitors until the lock is removed and `main` builds successfully.
2. **GitHub Production gate** currently fails without useful runner step logs through the available integration. A complete `npm ci && npm run check && npm run test:browser` result is still required.
3. **Signup SMTP authentication** had recent `535 5.7.8` failures and signup HTTP 500 responses. Updating the credential directly in Supabase SMTP settings and testing a real verification message remains necessary; secrets must not be pasted into a chat.
4. **Sentry API is not configured** in this environment (`SENTRY_AUTH_TOKEN` missing). No genuine production Sentry issue list could be retrieved.
5. **Remaining Supabase advisors** are not equivalent to confirmed failures. After these changes, security notices included 11 anonymous-executable SECURITY DEFINER functions, 83 authenticated-executable ones, 40 RLS-on/no-policy notices (many internal/service-only), and leaked-password protection disabled. Performance notices included 58 unindexed foreign keys, 43 auth RLS initplan cases, 128 duplicate permissive policy cases, 3 duplicate indexes, and 120 unused-index notices. Review each against explicit role contracts before changing privileges or indexes.
6. **Full end-to-end coverage is not complete**: authenticated mobile browser, moderator/admin/super-admin features, public Spaces joining, live replies and notifications need deployment-time tests. Current SQL-only checks cannot prove LiveKit, frontend event listeners, external email and every PostgREST endpoint are error-free.
7. **Optional feed candidate refresh RPC remains disabled**, correctly, until its review-only SQL and feed-visibility tests are ready.

## Safe release checklist

1. Confirm GitHub `main` and run the complete project checks locally or in CI.
2. Unlock Blipmood's published deployment via Netlify and publish the validated `main` commit, keeping existing settings and free hosting.
3. Smoke-test user flows on the published deploy: guest topic request; sign-in/up and verification email; ordinary user comments/replies; organization/workspace/project creation + update; chat previews and groups; public Space join; private Stories; admin account restriction listing, application and revocation; super-admin user list fallback.
4. Watch Supabase Postgres/PostgREST logs and the Netlify function logs for `42501`, `42703`, `42883`, `PGRST202`, and `5xx` errors. Distinguish intentional access denials from unexpected error conditions.
5. Roll back the frontend release if browser testing fails. Do not disable RLS globally or delete data to silence a permission error.

## Principles

No new branch was created. No existing user accounts, stories, posts or chat messages were removed. No paid plan or external secrets were enabled. Security boundaries remain in place. Database schema repairs were additive and verified by role-scoped tests; broader sweeping advisor changes were deliberately not applied.
