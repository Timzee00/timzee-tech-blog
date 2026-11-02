# Blipmood × Cloudflare R2 — public media

Status on **2 November 2026**: **prepared, disabled**. Cloudflare connection is authenticated, Workers subdomain `blipmood-timzee` created, but R2 API returns **403 / 10042** (`Please enable R2 through the Cloudflare Dashboard`). Do not turn on client-side routing before the bucket and Worker have passed end-to-end tests.

## Intent

- Keep Supabase authentication, Postgres/RLS, upload ownership checks, and private files untouched.
- Deliver existing **public** photos and videos through a private Cloudflare R2 bucket + read-only Worker.
- On first request, Worker retrieves a public Supabase object, mirrors it to R2, then serves future requests from R2. Video byte-range requests are supported.
- Existing database URLs stay unchanged; the client has a reversible, currently empty `WORKER_ORIGIN` in `assets/js/media-delivery.mjs`.
- **No expiring Stories, signed URLs, chat attachments, private media or user uploads through R2.**
- A conservative 24 MiB per-object mirror cap prevents unbounded buffering. Larger objects redirect to the old Supabase URL instead of breaking playback.
- CDN mirroring **still incurs a one-time Supabase origin transfer for each object**; avoid loading the entire library while the current Supabase organization is over quota.

## Required Cloudflare activation

1. Open <https://dash.cloudflare.com/?to=/:account/r2/overview> using the account connected as `salawudeentimileyin16@gmail.com`. Activate R2. The dashboard may ask for billing or payment setup. **Check and approve charges yourself**; do not assume R2 has a hard spend limit.
2. Use **Standard** storage class, not Infrequent Access. R2 has no egress charge, but storage and Class A/B operations can be billable outside the monthly free allowance. See <https://developers.cloudflare.com/r2/pricing/>.
3. Create a **private** R2 bucket named `blipmood-public-media`. Leave the bucket's public development URL disabled. No S3 keys or service-role credentials are needed by the Worker.
4. Once R2 is active, run from `cloudflare/blipmood-media`: `npx wrangler deploy` (or deploy an equivalent Worker with the configured R2 binding).
5. Verify `https://blipmood-public-media.blipmood-timzee.workers.dev/health` returns 200 and JSON `{"ok":true}`.
6. Confirm a public thumbnail GET, original video GET, video `Range: bytes=0-1023` returning 206, HEAD metadata, origin cached-once behavior, invalid path rejection, and no private media access.
7. Resolve R2 cache retention and deletion/purge workflow **before production activation**. Videos, posts, avatars and moderation deletions must invalidate copies promptly. Current prototype does not yet implement the deletion purge path. This is a release blocker.
8. After all checks pass, change `WORKER_ORIGIN = ""` in `assets/js/media-delivery.mjs` to the **verified** HTTPS Worker origin, and deploy to Netlify from `main`. A blank value immediately rolls back delivery to Supabase.
9. Monitor Supabase cached and uncached egress and Cloudflare R2 storage, operations and Worker request/CPU use. Do not mass-fetch every video from Supabase to populate R2 during the ongoing quota warning.

## Deployment reminders

Blipmood's Netlify **production deployment was locked at `982f200`** in the last dashboard inspection. GitHub's Production gate has also failed before runner steps started. Verify the latest `main` passes tests and publishes successfully before claiming these files are live.

Test: `node --test tests/cloudflare-r2-media-worker.test.cjs`.

## Security constraints

Never commit secrets or add a privileged bypass to `platform_video_upload_gate`, `publish_story` or any RLS policy. Do not make the R2 bucket public. Only the Worker serves whitelisted public files. All folder and host validation happens server-side; the browser URL switch is a defense-in-depth optimization, not an authorization control.

The R2 Worker currently performs read-through GET/HEAD operations only, with **no upload, user modification or object-deletion API**. Finish secure deletion invalidation before switching real user traffic.
