# Blip Earn · Phase A release notes · 2026-10-31

**State: foundation built; referrals disabled by default; no cash program launched.**

## Implemented

- Supabase schema with owner-only unique short codes, immutable one-referral-per-invitee attribution and RLS closed to ordinary browser accounts
- Service-only code issuance and claim RPCs that lock the founder feature switch; 8 code attempts per account/day and 14-day retention of rate-limit records
- Live count of *email-confirmed + fully onboarded + active-profile* members; this is **not** DAU or unique visitors
- Automatic stop at the configured activated-member goal (0 disables automatic cap), plus instant manual founder pause
- Secure role-checked founder controls and private audit history, with a 15-entry Super Admin audit summary
- Expiring referral codes captured at login and presented as optional entry in existing three-stage onboarding for adults; onboarding still works if referral service is unavailable
- Member dashboard with code, invitation link, pending/qualified/rejected counts and transparent noncash milestones; reattempt available for recent accounts
- Supabase database program starts **enabled=false**, **target=0**; no source code implements a payout, wallet or cash reward

## Paths

- Member: `/blip-earn.html`
- Super Admin: `/super/referrals.html`
- Function: `/.netlify/functions/blip-earn`
- Capture: `assets/js/referral-capture.mjs`
- Onboarding: `welcome.html`, `assets/js/member-onboarding.mjs`
- Repository tests: `tests/blip-earn-phase-a.test.cjs` (called by `npm run check`)

## Activation and safe pause

1. Deploy `main` successfully to Netlify (this repository's published deploy was found locked on 2026-10-31, still publishing an older 2026-10-28 commit).
2. Sign in as Super Admin; open `super/referrals.html`.
3. Set a verified-onboarded member goal. Setting 0 means manual-off only.
4. Enter a written reason (at least 12 characters) and explicitly save the switch. **Turning it ON only accepts referral attribution; it does not create an obligation to pay ₦1,000.**
5. Switch OFF whenever you want to stop new referrals. Attributions and previously issued codes remain stored; new claims and new code issuance are blocked in Postgres, not just hidden in the interface.
6. Review `Recent audited changes` to confirm the result. For urgent pause, use the same Super Admin page; do not rely on CDN cache invalidation.

## Verified database tests

Using rollback-only transactions on the live Supabase project:

- Founder switch enabled with a target already met → automatic pause blocked new referrals.
- A valid founder enabled program minted a code; subsequent founder pause rejected another new code.
- One verified, newly registered adult account was attributed to an older inviter, and a duplicate claim returned `already_recorded`.
- Eight same-day claim attempts were accepted for validation; the ninth was denied.
- The founder audit RPC read the changes.
- After rollback: program OFF, 0 invitation codes and 0 referral claims.

The browser/Netlify deploy was **not** fully verified here. Tests are not a replacement for a complete `npm run build` and a real two-account mobile acceptance run.

## Phase B not yet enabled

- Fraud-reviewed qualification based on authentic meaningful activity on three distinct days
- Separate underage and trusted-residency safeguards before future cash eligibility
- Fully funded campaign terms and caps, amount-reserved ledger, private destination collection, payout approval and reconciliation
- Official support chat case lifecycle; no account numbers, PINs or OTPs should be sent over ordinary chat
- Marketplace Boost and Business Pro to finance sustainable rewards

**Do not advertise cash or airtime referral payments until the above financial systems and approved funding are ready.**
