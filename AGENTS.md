# Blipmood engineering agent instructions

Work in the existing `main` branch; do not create a new branch unless explicitly requested. Keep the Netlify frontend, Supabase Auth/Postgres/RLS, Brevo email and LiveKit audio integration intact. Avoid surprises: no paid infra, destructive data changes, private media exposure or DB policy bypasses.

## Cloudflare integration

Follow Cloudflare's current agent setup documentation: <https://developers.cloudflare.com/agent-setup/> and the Cloudflare R2/Workers docs. Consult current docs and applicable project skills rather than treating old API shapes, limits or prices as authoritative.

- The new Cloudflare Worker is in `cloudflare/blipmood-media/`, with deployment configuration in `wrangler.jsonc`.
- Cloudflare R2 has NOT been activated yet. Never claim it is live until the Cloudflare API confirms a bucket and the Worker is deployed and tested.
- `assets/js/media-delivery.mjs` is the deliberately **disabled** read-only URL routing switch. Keep it disabled until tests, storage activation, deletion invalidation and a production deployment all pass.
- New public videos and Stories still use Supabase upload and ownership validation. Private chat, member-only community media and expiring Stories must never be mirrored into public R2.
- Do not weaken `platform_video_upload_gate`, `publish_story`, ownership checks or RLS to make R2 uploads work.
- R2 may bill for storage and requests above free allowance, even though R2 does not charge for egress. Never silently upgrade or enable billable subscriptions.
- Validate via `npm run check:cloudflare-media`, then full `npm run check` and mobile browser smoke tests before activating traffic.

Current status, activation instructions, rollout and rollback are in `cloudflare/blipmood-media/README.md`.
