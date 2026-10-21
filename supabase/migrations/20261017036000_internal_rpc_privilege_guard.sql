-- Internal SECURITY DEFINER trigger functions and automod scoring helpers
-- are called by database triggers, not browser RPCs. Prevent direct invocation.
DO $guard$
DECLARE rec record;
BEGIN
 FOR rec IN
   SELECT n.nspname AS schema_name, p.proname AS function_name,
          pg_get_function_identity_arguments(p.oid) AS args
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef
     AND (p.prorettype='pg_catalog.trigger'::regtype
       OR p.proname='forum_automod_reason')
 LOOP
   EXECUTE format(
     'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
     rec.schema_name, rec.function_name, rec.args
   );
 END LOOP;
END $guard$;
