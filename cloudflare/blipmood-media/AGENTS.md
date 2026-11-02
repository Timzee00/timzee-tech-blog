# Cloudflare media delivery conventions for Blipmood

Follow the official Cloudflare Skills and the Code Mode API MCP. Do not deploy before R2 is enabled and a Standard bucket named `blipmood-public-media` exists.

The Worker is intentionally **read-only to public visitors**. It imports publicly accessible files from the Supabase `media` bucket into private R2 on the first request and subsequently serves them from R2. Never proxy private chat-media or any expiring story media. Never use a Supabase service-role key, S3 credential or bearer token in this Worker. The legacy Supabase URLs remain the source of truth in the database.

Do not modify the existing `platform_video_upload_gate` or `publish_story` authorization rules to accept unverified R2 uploads. Deployment is gated by a tested Worker URL, healthy R2 GET/HEAD/range behavior, and source-caching verification.

`assets/js/media-delivery.mjs` is **disabled by default**. Turn it on only after testing the actual Worker URL; preserve a one-line rollback to the blank Worker origin. Avoid enabling paid features or a paid Workers plan without approval.

Never delete or rewrite existing media, and do not expose a public R2 bucket. The Worker provides public access only for approved public path prefixes.

Never mirror `media/stories/` into R2: temporary public statuses must stay on their existing Supabase delivery path until an expiry-aware migration is separately designed.
