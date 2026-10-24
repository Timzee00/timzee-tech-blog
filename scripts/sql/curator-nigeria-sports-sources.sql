-- Curator Nigeria/sports source seed. Idempotent; run using owner credentials.
-- No automatic publishing or copying of third-party full articles.
BEGIN;
WITH curated(name,url,category,tags) AS (
 VALUES
  ('PUNCH Nigeria - Latest','https://rss.punchng.com/v1/category/latest_news','nigeria',ARRAY['nigeria','news']::text[]),
  ('PUNCH Nigeria - Sports','https://rss.punchng.com/v1/category/sports','sports',ARRAY['nigeria','sports']::text[]),
  ('PUNCH Nigeria - Technology','https://rss.punchng.com/v1/category/technology','technology',ARRAY['nigeria','technology']::text[]),
  ('PUNCH Nigeria - Business','https://rss.punchng.com/v1/category/business','business',ARRAY['nigeria','business']::text[]),
  ('PUNCH Nigeria - Entertainment','https://rss.punchng.com/v1/category/entertainment','entertainment',ARRAY['nigeria','entertainment']::text[]),
  ('Premium Times Nigeria','https://www.premiumtimesng.com/feed','nigeria',ARRAY['nigeria','news']::text[]),
  ('BBC All Sports','https://feeds.bbci.co.uk/sport/rss.xml','sports',ARRAY['sports','world']::text[]),
  ('BBC Africa','https://feeds.bbci.co.uk/news/world/africa/rss.xml','africa',ARRAY['africa','world']::text[]),
  ('BBC Football','https://feeds.bbci.co.uk/sport/football/rss.xml','sports',ARRAY['sports','football','world']::text[]),
  ('BBC Sport - Boxing','https://feeds.bbci.co.uk/sport/boxing/rss.xml','sports',ARRAY['sports','boxing','world']::text[]),
  ('BBC Sport - Athletics','https://feeds.bbci.co.uk/sport/athletics/rss.xml','sports',ARRAY['sports','athletics','world']::text[]),
  ('BBC Sport - Formula 1','https://feeds.bbci.co.uk/sport/formula1/rss.xml','sports',ARRAY['sports','motorsport','world']::text[]),
  ('BBC Sport - Tennis','https://feeds.bbci.co.uk/sport/tennis/rss.xml','sports',ARRAY['sports','tennis','world']::text[]),
  ('BBC Sport - Cricket','https://feeds.bbci.co.uk/sport/cricket/rss.xml','sports',ARRAY['sports','cricket','world']::text[]),
  ('ESPN - NBA','https://www.espn.com/espn/rss/nba/news','sports',ARRAY['sports','basketball','nba','world']::text[])
)
INSERT INTO public.curator_sources
 (id,name,url,feed_url,source_type,category,tags,enabled,is_active,max_items,created_at,updated_at)
SELECT gen_random_uuid(),name,url,url,'rss',category,tags,true,true,20,now(),now() FROM curated
ON CONFLICT (url) DO UPDATE
 SET category=excluded.category,tags=excluded.tags,enabled=true,is_active=true,updated_at=now();
UPDATE public.curator_sources
 SET enabled=false,is_active=false,
     last_error='Disabled: placeholder feed; replace in Netlify NEWS_FEEDS or NEWS_TIPS_FEEDS.',
     updated_at=now()
 WHERE url IN ('https://site1.com/rss','https://site2.com/feed','https://site3.com/tips.rss');
COMMIT;
