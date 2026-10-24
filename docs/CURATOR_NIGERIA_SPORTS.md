# Nigerian news and wider sports coverage

Scout is a bounded, editorial-review-only RSS importer. Its four fetch slots favour:
1. Oldest Nigerian general source.
2. Oldest sports source (Nigerian or global).
3. Oldest global general source.
4. Oldest otherwise eligible source.

Missing categories fall back to fair oldest-first selection. Every fetched source rotates by its saved last-fetched timestamp, including failures. Source data is seeded in `scripts/sql/curator-nigeria-sports-sources.sql`, which may safely be executed again. New source records remain subject to existing RLS. No new API key is necessary for RSS sources.

Feed references: PUNCH's official RSS directory https://rss.punchng.com/ ; Premium Times https://www.premiumtimesng.com/feed ; BBC Sport https://feeds.bbci.co.uk/sport/rss.xml . Feeds may become unavailable or rate-limited; use the stored source health status to replace them with authorized alternatives.

**Production follow-up:** remove the three site1/site2/site3 examples from Netlify's `NEWS_FEEDS` and `NEWS_TIPS_FEEDS` settings when convenient. Importer now ignores examples and never silently re-enables previously disabled feeds. After deploying verified code, inspect `system_job_status` for `curator-scout` and source-by-source outcomes, then review incoming Nigerian and sports draft quality. The import does not grant any third-party image or full-article republication license.

The source catalog was updated directly in Supabase on 2026-10-24. This document and seed script preserve the corresponding configuration in the repository. Do not confuse database source availability with successful live code deployment.
