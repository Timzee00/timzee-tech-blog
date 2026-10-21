-- Free, database-owned scheduled article publishing.
-- Previously the automation tick processed announcements but NOT posts.
-- At most 100 due articles are published per tick, with row locking to avoid
-- double processing when Netlify and PostgreSQL schedules overlap.
CREATE INDEX IF NOT EXISTS posts_pending_publication_idx
 ON public.posts(publish_at,id)
 WHERE status='scheduled' AND publish_at IS NOT NULL;

CREATE OR REPLACE FUNCTION private.publish_scheduled_posts_logged()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $publisher$
DECLARE v_count integer:=0;v_result jsonb;
BEGIN
 -- Do not let one slow run collide with another invocation of this publisher.
 IF NOT pg_try_advisory_xact_lock(19022026,1) THEN
  RETURN jsonb_build_object('ok',true,'skipped','already_running');
 END IF;
 INSERT INTO public.system_job_status(job_name,last_started_at,run_count,updated_at)
 VALUES('scheduled-articles',now(),1,now())
 ON CONFLICT(job_name) DO UPDATE SET
   last_started_at=EXCLUDED.last_started_at,
   run_count=public.system_job_status.run_count+1,
   updated_at=now();
 BEGIN
  WITH due AS (
   SELECT id FROM public.posts
   WHERE status='scheduled' AND publish_at IS NOT NULL
     AND publish_at<=now() AT TIME ZONE 'UTC'
   ORDER BY publish_at,id
   LIMIT 100 FOR UPDATE SKIP LOCKED
  ), published AS (
   UPDATE public.posts p
   SET status='published',updated_at=now() AT TIME ZONE 'UTC'
   FROM due d WHERE p.id=d.id
   RETURNING p.id
  )
  SELECT count(*) INTO v_count FROM published;
  v_result:=jsonb_build_object('ok',true,'published',v_count,'ran_at',now());
  UPDATE public.system_job_status SET
   last_succeeded_at=now(),last_error=NULL,last_result=v_result,updated_at=now()
  WHERE job_name='scheduled-articles';
  RETURN v_result;
 EXCEPTION WHEN OTHERS THEN
  UPDATE public.system_job_status SET
   last_failed_at=now(),last_error=left(SQLERRM,500),updated_at=now()
  WHERE job_name='scheduled-articles';
  RETURN jsonb_build_object('ok',false,'error','Scheduled article publishing failed');
 END;
END
$publisher$;
REVOKE ALL ON FUNCTION private.publish_scheduled_posts_logged()
 FROM PUBLIC,anon,authenticated;
-- pg_cron invokes this function independently of Netlify usage or billing.
SELECT cron.schedule('timzee-scheduled-articles-five-min','*/5 * * * *',
 'SELECT private.publish_scheduled_posts_logged()');
