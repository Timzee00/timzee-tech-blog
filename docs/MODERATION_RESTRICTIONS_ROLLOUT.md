# Moderation enforcement and automatic signals — review gate
Manual restrictions are in `docs/sql/review-only-account-restrictions.sql` and `manage-account-restrictions`.
The staff console is `/admin/restrictions.html`. **None of these are active until the SQL and Netlify deployment are approved.**

Automatic restrictions are **not** enabled. First implement an independent signals ledger:
- high-confidence events: >30 unsolicited direct messages/minute, rapid identical comment floods, repeated upload rejection;
- use bounded rolling windows and distinct recipient counts, never individual reports alone;
- record anonymized evidence, rule version, and detector timestamps; test with replay data and inspect false positives by segment;
- start in *shadow evaluation* (log only), then staff-review queues; allow high-confidence temporary write cooldowns only with approved explicit rules;
- expose user notice with restriction scope, rationale, expiration and appeal. Do not silently claim account activity is reaching others when it is hidden;
- permit moderators to recommend, admins to apply/revoke; keep super admins protected and audit immutable using a server-side append-only design.
- enforce relevant operations beyond REST INSERT (RPCs, storage uploads, Edge Functions, background jobs) before enabling on real users.
- do not call these systems fully enforced until regression tests confirm role boundaries, expiry, RLS behavior and appeals end-to-end.
