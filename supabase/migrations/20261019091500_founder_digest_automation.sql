-- Free-first operational digest, server-owned and exactly once per UTC day.
-- It notifies active super administrators about real pending work, never raw user content.
CREATE TABLE IF NOT EXISTS public.founder_digest_deliveries (
 recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 digest_day date NOT NULL,
 summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(recipient_id,digest_day)
);
ALTER TABLE public.founder_digest_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founder_digest_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.founder_digest_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.process_founder_operations_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
 v_day date:=(now() AT TIME ZONE 'UTC')::date;
 v_staff record;
 v_counts jsonb;
 v_reports integer:=0;
 v_community integer:=0;
 v_flags integer:=0;
 v_verification integer:=0;
 v_overdue integer:=0;
 v_sent integer:=0;
 v_claimed boolean;
BEGIN
 -- This routine may only be called by the server's service-role client.
 IF auth.uid() IS NOT NULL THEN
   RAISE EXCEPTION 'Service automation only' USING ERRCODE='42501';
 END IF;
 IF (now() AT TIME ZONE 'UTC')::time < time '08:00' THEN
   RETURN jsonb_build_object('notified',0,'skipped','before_digest_window');
 END IF;
 IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.role='super' AND p.account_status='active'
      AND NOT EXISTS (
        SELECT 1 FROM public.founder_digest_deliveries d
        WHERE d.recipient_id=p.id AND d.digest_day=v_day
      )
 ) THEN
   RETURN jsonb_build_object('notified',0,'skipped','already_delivered_or_no_recipient');
 END IF;
 SELECT count(*) INTO v_reports FROM public.content_reports WHERE status='open';
 SELECT count(*) INTO v_community FROM public.community_reports WHERE status='pending';
 SELECT count(*) INTO v_flags FROM public.community_auto_moderation WHERE state='pending';
 SELECT count(*) INTO v_verification FROM public.verification_applications WHERE status='pending';
 SELECT count(*) INTO v_overdue FROM public.posts
   WHERE status='scheduled' AND publish_at IS NOT NULL
     AND publish_at <= (now() AT TIME ZONE 'UTC');
 IF (v_reports+v_community+v_flags+v_verification+v_overdue)=0 THEN
   RETURN jsonb_build_object('notified',0,'skipped','no_pending_work');
 END IF;
 v_counts:=jsonb_build_object('reports',v_reports,'community_reports',v_community,
   'spam_signals',v_flags,'verification_applications',v_verification,
   'overdue_posts',v_overdue);
 FOR v_staff IN
   SELECT p.id FROM public.profiles p
   LEFT JOIN public.user_settings s ON s.user_id=p.id
   WHERE p.role='super' AND p.account_status='active'
     AND coalesce(s.preferences#>>'{notifications,operationsDigest}','true')<>'false'
   ORDER BY p.id
 LOOP
   v_claimed:=false;
   INSERT INTO public.founder_digest_deliveries(recipient_id,digest_day,summary)
   VALUES(v_staff.id,v_day,v_counts)
   ON CONFLICT DO NOTHING RETURNING true INTO v_claimed;
   IF coalesce(v_claimed,false) THEN
     PERFORM public.emit_user_notification(
       v_staff.id,'founder_operations',
       'Timzee operations need your review',
       format('%s site reports, %s community reports, %s spam signals, %s verification requests, %s overdue articles.',
         v_reports,v_community,v_flags,v_verification,v_overdue),
       '/admin/dashboard.html?tab=operations',
       jsonb_build_object('digest_day',v_day,'operation','founder_digest')
     );
     v_sent:=v_sent+1;
   END IF;
 END LOOP;
 RETURN jsonb_build_object('notified',v_sent,'counts',v_counts,'digest_day',v_day);
END
$function$;

REVOKE ALL ON FUNCTION public.process_founder_operations_digest()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_founder_operations_digest() TO service_role;
