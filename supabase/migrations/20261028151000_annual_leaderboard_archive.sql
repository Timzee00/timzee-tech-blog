-- Calendar-year leaderboard without resetting lifetime profile points.
CREATE TABLE IF NOT EXISTS public.leaderboard_year_scores (
  year integer NOT NULL CHECK (year BETWEEN 2026 AND 2100),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0 CHECK(score>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year,user_id)
);
ALTER TABLE public.leaderboard_year_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public annual ranks" ON public.leaderboard_year_scores;
CREATE POLICY "Public annual ranks" ON public.leaderboard_year_scores FOR SELECT TO anon,authenticated USING(true);
REVOKE ALL ON public.leaderboard_year_scores FROM PUBLIC;
GRANT SELECT ON public.leaderboard_year_scores TO anon, authenticated;
GRANT ALL ON public.leaderboard_year_scores TO service_role;
CREATE INDEX IF NOT EXISTS leaderboard_year_scores_top ON public.leaderboard_year_scores(year,score DESC);

CREATE TABLE IF NOT EXISTS public.leaderboard_year_winners (
 year integer NOT NULL CHECK(year BETWEEN 2026 AND 2100),
 rank smallint NOT NULL CHECK(rank BETWEEN 1 AND 3),
 user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 display_name text NOT NULL,
 score integer NOT NULL,
 awarded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (year,rank)
);
ALTER TABLE public.leaderboard_year_winners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public annual champions" ON public.leaderboard_year_winners;
CREATE POLICY "Public annual champions" ON public.leaderboard_year_winners FOR SELECT TO anon,authenticated USING(true);
REVOKE ALL ON public.leaderboard_year_winners FROM PUBLIC;
GRANT SELECT ON public.leaderboard_year_winners TO anon, authenticated;
GRANT ALL ON public.leaderboard_year_winners TO service_role;

CREATE OR REPLACE FUNCTION private.record_leaderboard_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE delta integer;
BEGIN
 delta:=greatest(0,coalesce(NEW.points,0)-coalesce(OLD.points,0));
 IF delta>0 THEN
  INSERT INTO public.leaderboard_year_scores(year,user_id,score)
   VALUES(EXTRACT(YEAR FROM now() AT TIME ZONE 'UTC')::int,NEW.id,delta)
   ON CONFLICT(year,user_id) DO UPDATE SET
    score=public.leaderboard_year_scores.score+excluded.score,updated_at=now();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profile_annual_points ON public.profiles;
CREATE TRIGGER profile_annual_points AFTER UPDATE OF points ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.record_leaderboard_points();

-- Current year's baseline: preserve progress from before annual scoring began.
INSERT INTO public.leaderboard_year_scores(year,user_id,score)
 SELECT 2026,id,greatest(0,coalesce(points,0)) FROM public.profiles
ON CONFLICT(year,user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.archive_previous_leaderboard()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE finished_year integer:=EXTRACT(YEAR FROM now() AT TIME ZONE 'UTC')::int-1;
BEGIN
 IF finished_year<2026 THEN RETURN;END IF;
 INSERT INTO public.leaderboard_year_winners(year,rank,user_id,display_name,score)
 SELECT finished_year,ranked.rnk,ranked.user_id,
   coalesce(nullif(p.display_name,''),nullif(p.username,''),'Member'),
   ranked.score
 FROM (
  SELECT user_id,score,row_number() OVER(ORDER BY score DESC,user_id) rnk
  FROM public.leaderboard_year_scores
  WHERE year=finished_year AND score>0
 ) ranked JOIN public.profiles p ON p.id=ranked.user_id
 WHERE ranked.rnk<=3
 ON CONFLICT(year,rank) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION private.archive_previous_leaderboard() FROM PUBLIC,anon,authenticated;
-- Retry each January 1st, after the UTC year boundary, with idempotent winners.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   PERFORM cron.schedule('blipmood-annual-leaderboard-archive','30 0 1 1 *','SELECT private.archive_previous_leaderboard()');
 END IF;
END $$;
