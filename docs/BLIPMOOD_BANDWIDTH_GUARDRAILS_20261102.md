# Blipmood media bandwidth safeguards — 2 November 2026

## Why this exists
The **Timzee Tech** organization on Supabase Free reached **12.186 GB cached egress / 5 GB** (244%) on its 23 October–23 November billing cycle. Supabase warned that projects may be restricted from **16 November** if usage remains excessive. Cached egress is transferred bytes, NOT the size of files stored. Already-served traffic cannot be retroactively removed by deleting a file.

A recent request-log sample identified a 6.1 MB topic MP4 requested 14 times (about 77 MB of returned content), including Chrome-Lighthouse sessions. This is a *sample* and not an exhaustive billing attribution.

## Changes on GitHub main
- Homepage trending topic cards link to discussion pages without requesting playable MP4s.
- Video discovery grid displays a lightweight static icon for old uploads missing thumbnails, never downloads the whole video to construct a preview. New uploads still generate and display a cover.
- Reels attach a `src` only for the active/explicitly selected video. Passive swipes have a 400 ms viewport-dwell delay before autoplay; data-saver and hidden tabs don't preload videos. Users can tap to play immediately.
- FYP and article video use `preload="none"`. Story playback only uses the active video and pauses the previous one before changing Stories.
- Photos uploaded through the shared uploader, and private Story photos, are downscaled and converted to WebP when supported and at least 12% smaller. GIFs, SVGs, audio, video and unsupported formats are never transcoded. Upload paths and MIME types match the generated WebP file.
- Automatically generated Reel covers are resized to a maximum 720px edge.
- Regression tests: `tests/media-egress-guardrails.test.cjs`. Any sitewide video preview change should retain the no-fetch contract.

## Important deployment / verification gate
Source-control commits do **not** prove the fix is live. Netlify's published production deployment was locked to commit `982f200` (31 October 2026) at last check. Unlock deployment and publish current `main`, then verify:
1. Homepage network tab shows **zero Supabase MP4 GET/206** requests before a user clicks a video topic.
2. `videos.html` shows legacy placeholders with no video range requests until a card opens.
3. Reels: rapid-swiping several clips does not download every item; waiting >400ms on an active reel or tapping plays normally. Data Saver requires a tap and browser backgrounding pauses video.
4. FYP and Stories remain playable; comments, replies, voice/music and private status permissions remain intact.
5. Run `npm run check` and browser tests. Existing GitHub Actions jobs were failing before runner steps executed, so **do not assume CI success**.
6. Watch actual billed `Cached Egress` by project in [Timzee Tech Usage](https://supabase.com/dashboard/org/xpfgfxvektzdsxxzompn/usage).

## Operating procedure for the Free plan
- Check the Supabase organization usage dashboard **daily until the current warning is resolved**, then at least weekly during growth. Cached and uncached egress have independent allowances.
- At **3 GB (60%)** cached egress in a fresh cycle, review the most requested storage objects and reduce unnecessary preview loading. At **4 GB (80%)**, prioritize media optimization or a migration to a dedicated video delivery service rather than increasing promotional traffic.
- Query recent storage request sizes in Supabase Logs Explorer using:
```sql
select
  log_attributes['request.path'] as path,
  count() as requests,
  sum(toUInt64OrZero(log_attributes['response.headers.content_length'])) as bytes_returned
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '%/storage/v1/object/%'
group by path
order by bytes_returned desc
limit 30;
```
  This is an investigative sample, not the authoritative billing meter.
- Avoid repeated Lighthouse crawls on the **live** homepage while it fetches public media. Prefer a staging deployment and check Network transfer.
- Supabase Image Transformations and Smart CDN are Pro features. Do not silently enable paid products or upgrade the plan; these optimizations work on Free.
- With enough genuine video playback, **5 GB cached egress can still be exhausted**. A strict ongoing guarantee requires either a separately metered/egress-appropriate media provider, a traffic cap, or a paid plan, each of which needs explicit infrastructure and budget decisions.
- Contact Supabase Support about the November 16 restriction: current-cycle bytes cannot be unserved, and the dashboard billing reset is November 23.

References:
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/storage/production/scaling
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video
