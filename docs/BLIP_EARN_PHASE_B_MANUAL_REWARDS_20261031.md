# Blip Earn · Phase B: Founder-funded personal rewards
**Date:** 2026-10-31
**Status:** Code and Supabase migrations implemented; BOTH referral acceptance and manual reward funding OFF by default. No automatic payment integration exists.

## How it works
- A newly registered, email-confirmed user aged 18+ may submit one valid referral code during setup (or shortly afterward).
- Each referral starts **pending**, and is never counted as qualified simply for registering.
- After three separate UTC days with persisted social interactions, an authorized Super Admin reviews the user. The human reviewer approves genuine activity or rejects suspicious referrals and records an explanation.
- Every 10 qualified referrals unlock eligibility for one **₦1,000 manual cash OR airtime reward**, but an actual award record is only created if the founder has separately enabled reward funding and provided an explicit lifetime award cap.
- The founder's award cap is stored and enforced transactionally in Postgres, never inferred from browser-visible totals. Example: max_awards=10 represents at most ₦10,000 in personally funded award records. No duplicate milestone can exist.
- An approved member chooses bank transfer or airtime. The site records only that choice, their consent option, and the award status; it **does not** collect a bank account number, phone number, OTP or password.
- The member opens an official **currently verified staff** Blipmood chat configured in Super Admin. Only after the founder actually sends cash/airtime do they mark the award **Paid** with a non-sensitive confirmation note.
- The founder may publish a paid winner's public @username only if that member opted in. The member can revoke consent at any time, which removes the listing. Public winners have no private or payment details.
- The founder can copy an approved winners announcement and post it to a separately created channel. The site may link to an explicitly configured HTTPS channel, but it **does not** create or post to the channel automatically.

## Controls
1. Go to `/super/referrals.html` when a successful Netlify build of this repository is published.
2. **Accept new referrals** controls new code issuance and new attribution. Set an optional verified-member target for automatic closure. Existing referrals are never deleted by closure.
3. **Allow NEW founder-funded awards** is a different switch, initially OFF. Enter the number of lifetime ₦1,000 awards you can personally fund. A currently verified staff @username is mandatory to enable this switch. The winners channel link is optional.
4. Pending referrals display their number of distinct recorded action days. Review them manually and add a written reason.
5. After a member has ten approved referrals, an award is created within the cap; "Catch up on eligible rewards" can issue overlooked milestones without duplication.
6. The member requests their manual payout. After you personally pay them, confirm it in **Personal payment requests**. No transfer is made by the website.
7. Publish a paid winner only if they opted in. Copy the consented list for your external channel or visit `/blip-winners.html`.

## Implementation
- Migration versions: `20261031123335_blip_earn_manual_review_rewards.sql`, `20261031123437_blip_earn_polymorphic_audit_fix.sql`, `20261031124304_blip_earn_reward_config_reason_audit.sql`, `20261031124655_blip_earn_manual_payment_privacy_hardening.sql`.
- All privileges on new public tables and RPCs are revoked from `anon` and `authenticated`; only the verified Netlify API with the service role can access them.
- All state changes are audited in a private table. Payment confirmation notes reject long digit sequences and should never contain account details.
- `netlify/functions/blip-earn.js` enforces session and live role checks for member/super operations.
- User dashboard: `blip-earn.html`; staff: `super/referrals.html`; public consent-only winners board: `blip-winners.html`.
- Regression suites: `tests/blip-earn-phase-a.test.cjs` and `tests/blip-earn-manual-rewards.test.cjs`.

## Testing and launch
- Live Supabase rollback tests covered actual manual reward minting, unique milestones, one-award cap, claim, paid record, opt-in publication and withdrawal of consent. **All test changes were rolled back.**
- Migrations are in the live Blipmood database; initial reward funding remains OFF with zero cap, zero award records and no real payments sent.
- Successful Netlify build, deployed function availability and two-account mobile browser testing have **not been confirmed**. Do not announce a cash promotion until deployment works, staff-chat configuration is verified and the founder has a funding budget.
- This system performs no KYC identity-proofing or duplicate-device detection and is not a substitute for human abuse review. Activity metrics are signals, not proof by themselves.
