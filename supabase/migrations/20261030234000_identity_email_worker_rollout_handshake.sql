-- Service-role rollout handshake: only the upgraded Netlify email worker
-- can release identity email jobs held for the previous incompatible worker.
create or replace function public.activate_identity_email_dispatch()
returns jsonb language plpgsql security definer set search_path='pg_catalog' as $body$
declare released integer:=0;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise exception 'forbidden';
 end if;
 update private.identity_email_delivery_controls
 set delivery_ready=true,updated_at=now()
 where singleton and delivery_ready=false;
 update private.email_jobs
 set next_attempt_at=now(),updated_at=now()
 where template='identity_update' and status='pending'
   and next_attempt_at='infinity'::timestamptz;
 get diagnostics released=ROW_COUNT;
 return jsonb_build_object('released',released);
end $body$;
revoke all on function public.activate_identity_email_dispatch() from public,anon,authenticated;
grant execute on function public.activate_identity_email_dispatch() to service_role;
notify pgrst,'reload schema';
