-- Make verified staff contact mandatory before activating founder-funded manual awards.
-- Payment confirmations cannot contain long number sequences (bank accounts/phone numbers).
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
 if p_enabled and v_support is null then
  raise exception 'Configure a verified Blipmood staff chat before enabling manual rewards' using errcode='22023';
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

create or replace function public.blip_reward_mark_paid(p_actor uuid,p_award uuid,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare award public.blip_manual_rewards%rowtype;
begin
 perform private.blip_reward_require_super(p_actor);
 if char_length(btrim(coalesce(p_note,'')))<12 or char_length(p_note)>500 or p_note ~ '[0-9]{6,}'
 then raise exception 'Record a 12-500 character non-sensitive payment confirmation' using errcode='22023';end if;
 select * into award from public.blip_manual_rewards where id=p_award for update;
 if not found or award.status<>'requested'
 then raise exception 'Only requested unpaid rewards may be marked paid' using errcode='55000';end if;
 update public.blip_manual_rewards
 set status='paid',paid_at=now(),paid_by=p_actor,
 confirmation_note=left(btrim(p_note),500),updated_by=p_actor,updated_at=now()
 where id=p_award;
 return jsonb_build_object('status','paid','amount_naira',1000,
  'message','Payment recorded by Super Admin; no funds were transferred by the website');
end $$;
revoke all on function public.blip_reward_mark_paid(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.blip_reward_mark_paid(uuid,uuid,text) to service_role;
