-- Compatibility patch for current PostgREST JWT claim GUCs.
-- auth.role() is Supabase's canonical accessor: it uses the signed request
-- JWT's modern request.jwt.claims.role with legacy GUC fallback.
-- Keep *all* existing authorization comparisons, grants and function bodies.
-- Never replace an authorization check with a constant service_role.
DO $compat$
DECLARE
  entry record;
  original_definition text;
  patched_definition text;
  modified_count integer := 0;
BEGIN
  FOR entry IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prokind='f' AND n.nspname='public'
      AND p.proname = ANY (ARRAY[
        'admin_manage_verified_identity',
        'can_send_inactivity_reminder',
        'can_send_workflow_status',
        'check_digest_consent',
        'claim_email_jobs',
        'claim_staff_email_reply',
        'claim_web_push_deliveries',
        'complete_email_job',
        'complete_web_push_delivery',
        'email_delivery_statistics',
        'enable_my_inactivity_reminders',
        'enforce_direct_message_permission',
        'finish_staff_email_reply',
        'get_staff_email_reply_status',
        'is_email_suppressed',
        'legacy_user_recovery_overview',
        'list_email_review_cases',
        'opt_out_inactivity_from_email',
        'prepare_email_digests',
        'prepare_inactivity_reminders',
        'quarantine_email_job',
        'record_brevo_delivery_event',
        'record_email_review_action',
        'record_my_site_visit',
        'register_email_suppression',
        'suppress_email_job'
      ]::text[])
      AND pg_get_functiondef(p.oid) LIKE '%request.jwt.claim.role%'
    ORDER BY p.proname
  LOOP
    original_definition := pg_get_functiondef(entry.oid);
    patched_definition := regexp_replace(
      original_definition,
      'current_setting\s*\(\s*''request\.jwt\.claim\.role''\s*,\s*true\s*\)',
      'auth.role()', 'gi'
    );
    IF patched_definition = original_definition THEN
      RAISE EXCEPTION 'Role compatibility patch did not match function %', entry.proname;
    END IF;
    EXECUTE patched_definition;
    modified_count := modified_count + 1;
  END LOOP;
  IF modified_count < 20 THEN
    RAISE EXCEPTION 'Expected legacy role guards were not found (% patched)', modified_count;
  END IF;
END $compat$;
