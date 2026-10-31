-- Ensure separate founder-funded budget changes retain the mandatory audit reason.
-- Fix PL/pgSQL trigger record-field lookup across settings, claims and awards.
-- CASE expressions plan field access eagerly; JSONB field lookup is safe for each record type.
create or replace function private.blip_reward_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare data_now jsonb:=to_jsonb(new);
 data_before jsonb;
 actor uuid;
 reward uuid;
 referrer uuid;
 referee uuid;
 note text;
begin
 data_before:=case when TG_OP='INSERT' then null else to_jsonb(old) end;
 actor:=coalesce(nullif(data_now->>'reviewed_by',''),nullif(data_now->>'updated_by',''))::uuid;
 reward:=nullif(data_now->>'id','')::uuid;
 referrer:=nullif(data_now->>'referrer_id','')::uuid;
 referee:=nullif(data_now->>'referred_user_id','')::uuid;
 note:=coalesce(nullif(data_now->>'review_note',''),nullif(data_now->>'confirmation_note',''));
 if TG_TABLE_NAME='blip_reward_controls' then
  note:=nullif(current_setting('blip_reward.change_reason',true),'');
 end if;
 insert into private.blip_reward_audit(
  event_type,actor_id,reward_id,referrer_id,referral_user_id,previous,current,explanation
 ) values(TG_TABLE_NAME||':'||TG_OP,actor,reward,referrer,referee,data_before,data_now,note);
 return new;
end $$;
revoke all on function private.blip_reward_audit_change() from public,anon,authenticated;

create or replace function public.blip_reward_admin_config(
 p_actor uuid,p_enabled boolean,p_max_awards integer,p_chat_username text,
 p_channel_url text,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_support uuid; v_channel text;
begin
 perform private.blip_reward_require_super(p_actor);
 if p_enabled is null or p_max_awards is null or p_max_awards not between 0 and 1000
 or (p_enabled and p_max_awards=0) or length(btrim(coalesce(p_reason,'')))<12
 then raise exception 'Invalid reward funding or reason' using errcode='22023';end if;
 if p_chat_username is not null and btrim(p_chat_username)<>'' then
  select p.id into v_support from public.profiles p
  where lower(p.username)=lower(regexp_replace(btrim(p_chat_username),'^@',''))
   and p.role in ('super','admin') and p.account_status='active' and p.is_verified is true;
  if v_support is null then raise exception 'Choose a currently verified active staff account' using errcode='22023';end if;
 end if;
 v_channel:=nullif(btrim(coalesce(p_channel_url,'')),'');
 if v_channel is not null and (length(v_channel)>350 or v_channel !~ '^https://[^[:space:]]+$')
 then raise exception 'Only an HTTPS winners-channel URL is allowed' using errcode='22023';end if;
 perform set_config('blip_reward.change_reason',left(btrim(p_reason),500),true);
 update public.blip_reward_controls set
  enabled=p_enabled,max_awards=p_max_awards,
  official_chat_account=v_support,winners_channel_url=v_channel,
  updated_by=p_actor,updated_at=now()
 where singleton=true;
 return jsonb_build_object('enabled',p_enabled,'max_awards',p_max_awards,
 'official_chat_configured',v_support is not null, 'channel_url',v_channel,
 'message','Manual cash or airtime only; no payment gateway');
end $$;
revoke all on function public.blip_reward_admin_config(uuid,boolean,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.blip_reward_admin_config(uuid,boolean,integer,text,text,text) to service_role;
