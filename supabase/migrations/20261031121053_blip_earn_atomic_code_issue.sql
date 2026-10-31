-- Atomically issue a referral code with the same founder pause and member cap as attribution.
-- An enabled status from an earlier HTTP request is never sufficient to mint a code.
create or replace function public.blip_referral_issue_code(p_user uuid,p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare cfg public.blip_referral_settings%rowtype;
 issued text; metrics jsonb; verified timestamptz; state text;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 if p_user is null or coalesce(p_code,'') !~ '^BL[0-9A-F]{12}$'
 then raise exception 'Invalid invitation code format' using errcode='22023';end if;
 select code into issued from public.blip_referral_codes where owner_id=p_user;
 if found then return issued;end if;
 select * into cfg from public.blip_referral_settings where singleton=true for update;
 if not found or not cfg.enabled
 then raise exception 'New referrals are paused' using errcode='55000';end if;
 metrics:=private.blip_referral_member_metrics();
 if cfg.target_activated_members>0 and
  coalesce((metrics->>'activated_members')::bigint,0)>=cfg.target_activated_members
 then raise exception 'Referral member target reached' using errcode='55000';end if;
 select u.email_confirmed_at,p.account_status into verified,state
 from auth.users u join public.profiles p on p.id=u.id
 where u.id=p_user and u.deleted_at is null;
 if verified is null or state is distinct from 'active'
 then raise exception 'Your verified active account is required' using errcode='42501';end if;
 insert into public.blip_referral_codes(owner_id,code)
 values(p_user,p_code) on conflict(owner_id) do nothing;
 select code into issued from public.blip_referral_codes where owner_id=p_user;
 if issued is null then raise exception 'Invitation code could not be issued' using errcode='55000';end if;
 return issued;
end $$;
revoke all on function public.blip_referral_issue_code(uuid,text) from public,anon,authenticated;
grant execute on function public.blip_referral_issue_code(uuid,text) to service_role;
