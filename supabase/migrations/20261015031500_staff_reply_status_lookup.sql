-- Read-only status for a single audited staff email attempt.
-- Called only by service role after a live staff session is verified by Netlify.
-- Does not expose the recipient, content, or Brevo provider ID.
create or replace function public.get_staff_email_reply_status(
 p_actor_id uuid,p_client_request_id uuid
) returns jsonb language plpgsql stable security definer
set search_path to pg_catalog,private
as $body$
declare result jsonb;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
   raise exception 'forbidden' using errcode='42501';
 end if;
 select jsonb_build_object('status',r.status,'request_id',r.client_request_id,
    'created_at',r.created_at,'updated_at',r.updated_at,
    'provider_accepted',r.status='accepted',
    'needs_manual_review',r.status='needs_review')
 into result from private.staff_email_replies r
 where r.actor_id=p_actor_id and r.client_request_id=p_client_request_id;
 return coalesce(result,jsonb_build_object('status','not_found'));
end
$body$;
revoke all on function public.get_staff_email_reply_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_staff_email_reply_status(uuid,uuid) to service_role;