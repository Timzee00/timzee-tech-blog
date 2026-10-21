-- Journal the verification cron independently from the web host. Do not
-- expose raw identity documents or moderation approval to the browser.
CREATE OR REPLACE FUNCTION private.run_verification_maintenance_logged()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $maintenance$
DECLARE v_result jsonb;
BEGIN
  INSERT INTO public.system_job_status(job_name,last_started_at,run_count,updated_at)
  VALUES ('verification-maintenance',now(),1,now())
  ON CONFLICT (job_name) DO UPDATE SET
    last_started_at=excluded.last_started_at,
    run_count=public.system_job_status.run_count+1,
    updated_at=now();
  BEGIN
    v_result:=public.process_verification_maintenance();
    UPDATE public.system_job_status
       SET last_succeeded_at=now(),last_error=NULL,last_result=v_result,updated_at=now()
     WHERE job_name='verification-maintenance';
    RETURN jsonb_build_object('ok',true,'result',v_result);
  EXCEPTION WHEN OTHERS THEN
    -- Rethrowing would roll back this failure journal.
    UPDATE public.system_job_status
       SET last_failed_at=now(),last_error=left(SQLERRM,500),updated_at=now()
     WHERE job_name='verification-maintenance';
    RETURN jsonb_build_object('ok',false,'error','Verification maintenance failed; see system job status');
  END;
END
$maintenance$;
REVOKE ALL ON FUNCTION private.run_verification_maintenance_logged()
 FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('timzee-verification-maintenance-daily','35 4 * * *',
 'SELECT private.run_verification_maintenance_logged()');
