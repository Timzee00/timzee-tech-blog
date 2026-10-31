-- Role-check correction for the audited referral admin switch.
-- PostgreSQL CURRENT_ROLE is special syntax; use a non-reserved PL/pgSQL variable.
create or replace function public.blip_referral_admin_save(
 p_actor uuid,p_enabled boolean,p_target integer,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_role text; updated public.blip_referral_settings%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 select p.role into v_actor_role from public.profiles p
 where p.id=p_actor and p.account_status='active' for share;
 if v_actor_role is distinct from 'super'
 then raise exception 'Super admin role required' using errcode='42501';end if;
 if p_enabled is null or p_target is null or p_target not between 0 and 10000000
 or char_length(btrim(coalesce(p_reason,'')))<12
 then raise exception 'Provide a valid enabled setting, target and reason (at least 12 characters)' using errcode='22023';end if;
 perform set_config('blip_referral.change_reason',left(btrim(p_reason),500),true);
 update public.blip_referral_settings
 set enabled=p_enabled,target_activated_members=p_target,
 updated_at=now(),updated_by=p_actor
 where singleton=true returning * into updated;
 if not found then raise exception 'Referral settings unavailable' using errcode='55000';end if;
 return public.blip_referral_program_status();
end $$;
revoke all on function public.blip_referral_admin_save(uuid,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.blip_referral_admin_save(uuid,boolean,integer,text) to service_role;
