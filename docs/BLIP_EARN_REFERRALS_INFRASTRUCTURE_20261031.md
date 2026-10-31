# Blip Earn: Referral and Monetization Infrastructure Audit

**Status:** DESIGN ONLY — NOT LIVE, NOT A PAYMENT PROMISE.  
**Scope:** Existing Blipmood static frontend, Supabase, and Netlify Functions.  
**Decision:** Start with a limited, manually reviewed referral pilot; do not enable cash or airtime rewards until the control gates below pass.

## 1. Confirmed source-code inventory

| Capability | Actual implementation | Recommendation |
| --- | --- | --- |
| Email/password and Google/Apple sign-in | `login.html`, `assets/js/user-auth.js`, `assets/js/supabase.js` | Reuse Supabase Auth and PKCE. Do not add a second identity database. |
| Onboarding | `welcome.html`, `assets/js/member-onboarding.mjs`, migration `20261028151500_private_member_onboarding.sql` | Add OPTIONAL referral code in stage 1, only when active; retain existing 3 stages and privacy settings. |
| Trusted profile status | `netlify/functions/_lib/auth-role.js` | Server checks the account's live role and account_status; never trust client roles. |
| Private messaging | `chat.html`, `assets/js/chat-v2.js`, `chat_personal_views` migrations | Official verified referral-support chat can be added, but not used to collect bank PINs or account details in free-form messages. |
| Moderation investigations | `netlify/functions/moderation-cases.js`, audited staff RPC migrations | Reuse its authorization and investigation patterns; reward decisions need a **separate** staff permission and audit. |
| Notifications | Existing notifications UI, DB notifications, and email worker | Add notices for attribution, qualification, approval, payment, and appeal. |
| Country restrictions | `supabase/migrations/20261030004436_netlify_observed_geo_region_rules_20261030.sql`, `20261030004535_geo_feature_fail_closed_unknown_20261030.sql` | Creator monetization has a feature key, but no referral payout ledger. IP-based observed region is explicitly **not** verified residency. |
| Rewards/cash-out | No dedicated referral, wallet, earnings, or payout system found in the audited default branch | Must be designed and built. Profile points and XP are not currency. |

**Current blocker:** There are no campaign budgets, unique invitation codes, immutable attributions, verified activity proofs, balances, claim approvals, payment destinations, or payout audit trail for Blip Earn. UI alone would be unsafe.

## 2. Pilot product rule (proposed; do not advertise as active)

- **Pilot name:** Blip Rewards (part of Blip Earn).
- **Offer:** ₦1,000 for 10 *qualified*, directly invited new users; user chooses eligible bank transfer or airtime.
- **Pilot liability budget:** ₦20,000 fully funded BEFORE launch: at most 20 earned ₦1,000 rewards. Processing charges are extra and must also be budgeted.
- **Qualification proposal:** referred person uses a valid unique link/code, has a verified email, completes onboarding, and engages genuinely on three distinct days within 14 days of account creation. Mere page loads, bot activity, fake accounts, duplicate accounts, and same-person referrals do not count.
- **Eligibility:** earning cash restricted to verified eligible adult residents of supported country/countries. The onboarding age field is SELF-REPORTED, not sufficient for payout identity or residence checks. Minors may use the ordinary platform but must not be put into a cash-recruitment workflow.
- **Only one attribution per new account;** code application is allowed only during a short signup/onboarding window. No recruitment tiers/downlines.
- **Publish the terms, start/end, qualification requirements, budget/slots, review times, disputes, and treatment of already earned awards** before launch.
- Cash rewards DO NOT begin automatically when 10 accounts register; approval is based on a server-side qualification record and reserved reward budget.

## 3. Proposed data model (new Supabase migration required)

All financial and decision tables use RLS, deny direct anonymous access, and prohibit client-controlled monetary writes.

- `blip_referral_campaigns`: `id`, `status` (draft/active/paused/closed), `starts_at`, `ends_at`, `country_code`, `min_age`, `qualification_days`, `required_days_active`, `referrals_per_reward`, `reward_amount_kobo`, `committed_budget_kobo`, `reserved_budget_kobo`, `paid_budget_kobo`, `terms_version`, timestamps. Admin controls only. Budget reservations must be atomic, not inferred from a frontend counter.
- `blip_referral_codes`: `owner_id` primary key, collision-resistant random uppercase code unique, immutable issue timestamp; only owner may view their own code. No code should reveal a name, number, email, or internal UUID.
- `blip_referral_attributions`: `referred_user_id` unique (one referrer ever), `referrer_id`, `campaign_id`, code snapshot, first_applied_at, status pending/qualified/rejected, reason category, reviewed_at. Referrer cannot edit, change, or inspect the referred user's private record.
- `blip_referral_activity_days`: privacy-limited server-accepted user/day evidence; unique user/day, bounded retention. Reuse existing authenticated meaningful activity *after* proving event authenticity. Do not equate visitor analytics with distinct people.
- `blip_reward_ledger`: immutable integer-kobo credits, reservations, reversals and payments, each referencing a campaign, milestone and unique idempotency key. Never use `profiles.points` or JS-calculated balance for money.
- `blip_payout_requests`: owner, method, requested amount, state requested/under_review/approved/paid/rejected, staff reviewer, audit and external payment reference; no plain-text account numbers in public chat.
- `blip_payout_audit`: append-only authenticated staff actions, reason, timestamp, idempotent request ID.
- **Payment destinations:** store only what is necessary, encrypted/private or with a vetted payout provider; restrict access to authorized payout staff and define deletion policy. No bank PIN, OTP, password, BVN requests in chat.

Prefer server-only Netlify Functions using Supabase service credentials and live role checks for mutations, with database transactions/RPCs for atomic reservations and rewards; use owner-scoped RLS for private reads. Do not expose service keys to browsers or accept `user_metadata` as an authorization source.

## 4. Recommended API and frontend flow

1. `login.html?view=signup&ref=CODE` captures a format-limited code through a first-party functional flow, preserving it through email verification and OAuth. An optional editable referral code appears in **step 1** of `welcome.html` when an active program exists. Consent/privacy copy explains the referral association.
2. An authenticated, server-validated claim records the inviter ONCE. On invalid, ineligible, expired, or paused campaigns, show a clear error; never claim credit or break normal onboarding.
3. New `blip-earn.html`: signed-in user sees their code/link, pending count, qualified count, milestone progress, terms, reward reservation and payment history. No fictional balance, no `Withdraw` button without an approved payable balance.
4. A scheduled, idempotent qualifier examines genuine activity on distinct days. Anti-fraud rules return uncertain cases to human review; never auto-ban solely on shared IP/network or the same device.
5. Server-side milestone issuance uses 10 **unused** qualifying referrals per ₦1,000 award, **atomically** reserves campaign budget and writes the ledger; no double-pay on retry.
6. An eligible member requests a reward through a secure private payout form; a first-party official support chat thread may open for case updates. The chat cannot ask for passwords/OTP or be mistaken for payment authorization.
7. Trusted payout staff separately review destination, residency/age eligibility, proof, available balance, and duplicate payouts. Payment is recorded only after independently confirmed bank/airtime provider success.
8. Staff and users receive status notifications and have a documented dispute/appeal route.

## 5. Delivery sequence and acceptance gates

**Phase A — foundations (no payout):** database migration + RLS, secret-free invite code, referral-code validation and immutable attribution; optional onboarding field; member dashboard with pending vs qualified; default campaign state **draft/off**. On a missing migration, the UI must safely show 'not available' rather than block sign-in/onboarding.

**Phase B — qualification:** server-verified 3-day activity capture; dedupe and fraud triage; adult/residency eligibility review; referrer privacy; moderation appeal. Load-test RPC bounded queries and indexes.

**Phase C — funded pilot:** founder-funded ₦20k reserve, documented terms and start/end, 20 available milestone rewards, budget reservation, double-entry/append-only ledger, staff-only payout case system, secure payout destination and actual provider/manual payment reconciliation. Only then enable cash and airtime controls.

**Phase D — revenue:** optional paid Marketplace Boost, Business Pro, sponsored placement, fan tips, later revenue-backed creator sharing. Do not promise that arbitrary views earn money. Keep verification badges independent of paid plans.

### Release-gate tests

- New/corrupt/collision code, expired campaign, fake identity/duplicate account, self-referral, and a code changed after signup all fail closed.
- Distinct activity days must be genuine server events; 10 pending do not produce ₦1,000.
- Both budget and used-referral counts remain correct under 50+ concurrent requests; idempotent retries never duplicate rewards.
- Users cannot directly insert/update ledger, requests, activity evidence or other accounts' records.
- A paused campaign stops NEW promises but does not cancel an obligation already earned under published rules.
- Under-18/self-reported or unverified residency cannot unlock payouts; appeal does not leak staff notes.
- Authorized staff only; all decisions audited and payment references reconciled.
- Old signup, reset, onboarding, chat and mobile flows still pass; `npm run build` succeeds.
- Full Netlify deploy and live Supabase migration must be verified separately.

## 6. Current implementation boundary

**DO NOT automatically enable a paid promotion** from a UI or migration merge. The new program must be reviewed for Nigerian promotion/consumer rules and the Nigeria Data Protection Act, especially child protections, privacy notices and processing of payment information. Before payout activation confirm staff responsibility, sufficient funding, banking/airtime delivery method, support permissions and operating terms.

**Audit outcome:** Blipmood can support a referral program using its existing account, onboarding, moderation and notification foundations. It does not yet have the server-verified, financially auditable components needed to promise or pay cash. Build Phase A first and keep cash off.
