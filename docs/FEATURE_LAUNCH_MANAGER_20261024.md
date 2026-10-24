# Feature Launch Manager — operator guide

## Admin controls

Open **Admin Dashboard → 🚀 Feature Launches**, or **God Mode → 🚀 Feature Launches**.
Create a release card with a permanent slug, title, description, and status:
- **Coming soon**: tease an announced idea or upcoming capability.
- **In progress**: development is underway.
- **On hold**: temporarily paused; countdown is not shown as actively running.
- **Live now**: users can open the linked feature (when a link is supplied).

Specify a **countdown target** in your local time if desired. Target dates are estimates. A countdown reaching zero does **not** publish a release. **Automatically set Live** opt-in, if selected, promotes an eligible upcoming public feature on the first five-minute database worker tick after the date.

**Show on public launch board** determines whether the feature appears on /launches.html. Hidden cards can be edited by staff but are not available for public subscriptions. **Allow followers to get an in-app launch reminder** controls the opt-in reminder button and release notifications.

**Optional target page or section** lets you mark an existing page without guessing database IDs. Select an example from the datalist, e.g. /spaces.html or /index.html#suggestedPeopleSection. Public pages and sections display a neat informational status banner linking to the launch board; the banner does **not** enforce a backend feature lock. Protect unfinished APIs, content, or routes separately using server authorization.

The **Mark live** action explicitly publishes the feature. The permanent slug is not editable once created; this preserves subscribed users' reminder links. The admin search field filters existing cards.

## Reader-facing experience

/launches.html shows premium responsive release cards, labels, launch target dates, a live countdown when relevant, and opt-in **Remind me when live** for signed-in readers. Saved reminders are visible to the subscriber only; readers can cancel before release. No public email address, token or subscription list is disclosed.

On release, the database worker creates in-app notifications linking to the published feature card. It runs every five minutes and processes up to 200 subscriptions per invocation, with row-level locks and per-subscription notification timestamps to resist duplicate sends. Counts and delivery may therefore take longer for a very large audience. No Brevo launch email is promised; this phase covers **in-app notifications only**. The worker also runs independently of browser visits.

Users who disable the general Announcements notification category may not see a toast, but notifications remain available via their notification inbox according to existing preferences.

## Security and deployment

- New public tables are RLS-protected and their default table privileges explicitly narrowed in a second hardening migration.
- Anonymous visitors can read only public feature rows. All feature writes require a server-confirmed admin or super-admin role.
- Members can only read/subscribe/unsubscribe to their own reminder records and cannot subscribe to already live cards.
- No user-supplied HTML is injected into the launch board or contextual banners.
- Database scheduler: cron job timzee-feature-launches-five-min.
- Migration sequence (both required):
  1. 20261024173000_feature_launch_manager.sql
  2. 20261024173500_feature_launch_grants_hardening.sql

**Deploy sequence:** the live Supabase migrations can be applied independently, but the new UI is available to visitors only after Netlify publishes a build containing this code. The previous production deploy is unchanged until redeployment. Run npm run check, npm run build, and QA logged-in/guest interactions before considering a new rollout complete.
