CREATE TABLE IF NOT EXISTS public.system_job_status (
  job_name text PRIMARY KEY,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  last_result jsonb,
  run_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_job_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_job_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.system_job_status TO service_role;

CREATE OR REPLACE FUNCTION public.process_automation_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  published_count integer := 0;
  notification_count integer := 0;
  stories_deleted integer := 0;
  notifications_deleted integer := 0;
  result jsonb;
BEGIN
  INSERT INTO public.system_job_status(job_name,last_started_at,run_count,updated_at)
  VALUES ('automation-maintenance',now(),1,now())
  ON CONFLICT (job_name) DO UPDATE SET
    last_started_at=excluded.last_started_at,
    run_count=public.system_job_status.run_count+1,
    updated_at=now();

  BEGIN
    WITH due AS (
      SELECT a.*
      FROM public.announcements a
      WHERE a.notified_at IS NULL
        AND coalesce(a.status, 'published') = 'published'
        AND (a.publish_at IS NULL OR a.publish_at <= now())
      FOR UPDATE SKIP LOCKED
    ), marked AS (
      UPDATE public.announcements a
      SET notified_at = now(), updated_at = now(), status = 'published'
      FROM due d
      WHERE a.id = d.id
      RETURNING a.*
    )
    INSERT INTO public.notifications (id,user_id,type,title,body,link,data,created_at,read_at)
    SELECT gen_random_uuid(),p.id,'announcement',left(m.title,180),left(coalesce(m.body,m.message,''),1000),'/announcements.html',jsonb_build_object('announcement_id',m.id),now() AT TIME ZONE 'UTC',NULL
    FROM marked m
    CROSS JOIN public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications prior
      WHERE prior.user_id=p.id AND prior.type='announcement'
        AND prior.title=m.title AND prior.body=coalesce(m.body,m.message,'')
        AND prior.link='/announcements.html' AND prior.created_at>=m.created_at
    );
    GET DIAGNOSTICS notification_count = ROW_COUNT;

    SELECT count(*) INTO published_count
    FROM public.announcements
    WHERE notified_at >= (now() - interval '1 second');

    DELETE FROM public.stories WHERE expires_at < now();
    GET DIAGNOSTICS stories_deleted = ROW_COUNT;

    DELETE FROM public.notifications
    WHERE read_at IS NOT NULL
      AND read_at < (now() AT TIME ZONE 'UTC') - interval '180 days';
    GET DIAGNOSTICS notifications_deleted = ROW_COUNT;

    result := jsonb_build_object(
      'published_or_processed_announcements', published_count,
      'announcement_notifications_created', notification_count,
      'expired_stories_deleted', stories_deleted,
      'old_read_notifications_deleted', notifications_deleted,
      'ran_at', now()
    );

    UPDATE public.system_job_status
    SET last_succeeded_at=now(), last_error=null, last_result=result, updated_at=now()
    WHERE job_name='automation-maintenance';

    RETURN result;
  EXCEPTION WHEN others THEN
    UPDATE public.system_job_status
    SET last_failed_at=now(), last_error=left(SQLERRM,1000), updated_at=now()
    WHERE job_name='automation-maintenance';
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.process_automation_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_automation_tick() TO service_role;
