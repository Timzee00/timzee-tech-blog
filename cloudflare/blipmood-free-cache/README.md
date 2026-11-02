# Blipmood public media — Workers Free, no R2

**Status:** Worker deployed to `blipmood-free-media.blipmood-timzee.workers.dev`. Cloudflare API confirmed the Worker has `cache_options.enabled=true` and a workers.dev route, but browser HTTP smoke tests and Blipmood's production deployment still need to be completed.

This Worker uses the **Workers Free plan** and Cloudflare's Worker Response Cache. It never writes to or activates R2; it does not use private storage, API tokens, or a paid video service.

## Free-tier boundaries
- Up to **100,000 Worker requests per day**, shared with other Workers/Functions in the account, then requests can fail until the daily reset. Do not upgrade automatically.
- On a cache miss, the Worker may fetch a full public video of up to 12 MiB or public image up to 4 MiB, even if the browser requested only a range. The Cloudflare cache handles Range and returns `206` from a stored full `200` response. Bigger assets redirect to Supabase.
- Successful public responses are cached for **90 seconds**, limiting how long a removed public file may be accessible from Cloudflare's edge after deletion. The current Supabase origin may have its own separate cache TTL.
- Query strings, path traversals, expiring Stories, signed chat media, non-public uploads and all authenticated requests are excluded. Nothing is uploaded to Cloudflare.
- Every object fetched on a cache miss **still counts toward Supabase egress**, so the Worker does not guarantee the 5 GB Supabase limit will never be exceeded.

## Safe canary test (after Netlify publishes the new code)

Production traffic is **OFF by default** in `assets/js/media-delivery.mjs`, even though the Worker itself is deployed. Once the new Netlify deployment is live, open `https://blipmood.netlify.app/video.html?blipmood_cache_canary=1` in a test browser. That enables the Worker for that tab via session storage. Browse real public Reels, profiles and topics; inspect Network for successful `GET`/`206` and repeat `cf-cache-status: HIT`. Errors on images and video sources automatically retry their original Supabase URL once. Use `?blipmood_cache_canary=0` to turn canary mode off for the same browser tab. Do not enable all users until real playback and moderation/deletion tests pass.

## Test and rollout gates
1. Verify `https://blipmood-free-media.blipmood-timzee.workers.dev/health` responds 200 with `{"ok":true,"mode":"workers-free-cache","r2":false}`.
2. Verify a real small public image/video returns 200; a video with a `Range: bytes=0-1023` request returns 206. Repeat requests and confirm `cf-cache-status: HIT`; record Cloudflare and Supabase usage.
3. Verify a private or `stories/` URL returns 404, and query-string URLs return 400. Check user deletions and content moderation: do not activate if 90-second retention isn't acceptable.
4. Keep `assets/js/media-delivery.mjs` off until playback and fallback checks pass. With a verified Worker origin, it can be enabled and rolled back by changing one constant.
5. Restore normal Netlify production deploys. Latest changes are on `main`; Netlify's live deployment was locked at commit `982f200` on the last inspection.
6. Run `node --test tests/cloudflare-workers-free.test.cjs` and the regular `npm run check` before using in production.

## Official references

- [Workers Free pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers Caching](https://developers.cloudflare.com/workers/cache/)
- [Range caching](https://developers.cloudflare.com/workers/cache/configuration/#range-requests)
- [Worker cache limitations](https://developers.cloudflare.com/workers/cache/limitations/)
