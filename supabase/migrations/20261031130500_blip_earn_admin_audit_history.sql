-- Super-only, privacy-preserving recent founder changes for Blip Earn.
-- Returns bounded audit summaries; the full underlying audit stays private.
create or replace function public.blip_referral_recent_changes(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor_role text; v_history jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 select p.role into v_actor_role from public.profiles p
 where p.id=p_actor and p.account_status='active';
 if v_actor_role is distinct from 'super'
 then raise exception 'Super admin role required' using errcode='42501';end if;
 select coalesce(jsonb_agg(
  jsonb_build_object(
    'at',event.created_at,'reason',event.reason,
    'enabled',(event.new_value->>'enabled')::boolean,
    'target',(event.new_value->>'target_activated_members')::integer
  ) order by event.created_at desc
 ),'[]'::jsonb) into v_history
 from (
  select created_at,reason,new_value from private.blip_referral_settings_audit
  order by id desc limit 15
 ) event;
 return v_history;
end $$;
revoke all on function public.blip_referral_recent_changes(uuid) from public,anon,authenticated;
grant execute on function public.blip_referral_recent_changes(uuid) to service_role;
