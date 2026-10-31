-- Blip Earn Phase A: referral attribution only. NO cash, airtime, wallets, payouts or earned awards.
-- All direct client mutations are denied. The API uses a verified server session.
create table if not exists public.blip_referral_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 target_activated_members integer not null default 0 check(target_activated_members between 0 and 10000000),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
insert into public.blip_referral_settings(singleton,enabled,target_activated_members)
 values(true,false,0) on conflict(singleton) do nothing;
alter table public.blip_referral_settings enable row level security;
revoke all on public.blip_referral_settings from public,anon,authenticated;
grant select,update on public.blip_referral_settings to service_role;

create table if not exists public.blip_referral_codes (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 code text not null unique check(code ~ '^BL[0-9A-F]{12}$'),
 created_at timestamptz not null default now()
);
create index if not exists blip_referral_codes_code_idx on public.blip_referral_codes(code);
alter table public.blip_referral_codes enable row level security;
revoke all on public.blip_referral_codes from public,anon,authenticated;
grant select,insert on public.blip_referral_codes to service_role;

create table if not exists public.blip_referrals (
 referred_user_id uuid primary key references auth.users(id) on delete cascade,
 referrer_id uuid not null references public.profiles(id) on delete cascade,
 code_used text not null check(code_used ~ '^BL[0-9A-F]{12}$'),
 status text not null default 'pending' check(status in ('pending','qualified','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 check(referred_user_id <> referrer_id)
);
create index if not exists blip_referrals_referrer_status_idx on public.blip_referrals(referrer_id,status,created_at desc);
alter table public.blip_referrals enable row level security;
revoke all on public.blip_referrals from public,anon,authenticated;
grant select,insert on public.blip_referrals to service_role;

create table if not exists private.blip_referral_settings_audit (
 id bigint generated always as identity primary key,
 actor_id uuid,
 old_value jsonb not null,
 new_value jsonb not null,
 reason text not null default 'administrative_change',
 created_at timestamptz not null default now()
);
revoke all on private.blip_referral_settings_audit from public,anon,authenticated;
grant select,insert on private.blip_referral_settings_audit to service_role;
grant usage,select on sequence private.blip_referral_settings_audit_id_seq to service_role;

create table if not exists private.blip_referral_claim_attempts (
 user_id uuid not null references auth.users(id) on delete cascade,
 attempt_day date not null,
 attempts smallint not null default 1 check(attempts between 1 and 8),
 primary key(user_id,attempt_day)
);
revoke all on private.blip_referral_claim_attempts from public,anon,authenticated;
grant select,insert,update on private.blip_referral_claim_attempts to service_role;
create index if not exists blip_referral_claim_attempts_expiry_idx
 on private.blip_referral_claim_attempts(attempt_day);

create or replace function private.blip_referral_audit_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into private.blip_referral_settings_audit(actor_id,old_value,new_value,reason)
 values(new.updated_by,to_jsonb(old),to_jsonb(new),
 coalesce(nullif(current_setting('blip_referral.change_reason',true),''),'administrative_change'));
 return new;
end $$;
revoke all on function private.blip_referral_audit_settings() from public,anon,authenticated;
drop trigger if exists blip_referral_settings_audit_trigger on public.blip_referral_settings;
create trigger blip_referral_settings_audit_trigger
 after update on public.blip_referral_settings for each row
 execute function private.blip_referral_audit_settings();

-- "Activated members" means confirmed email, completed onboarding, and active profile.
-- This is NOT unique visitors, DAU, or proof of a payout-eligible adult.
create or replace function private.blip_referral_member_metrics()
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'activated_members',count(*),
  'recent_signins_30d', count(*) filter (
   where u.last_sign_in_at >= now() - interval '30 days'
  )
 )
 from auth.users u
 join public.profiles p on p.id=u.id and p.account_status='active'
 join public.member_onboarding o on o.user_id=u.id and o.completed_at is not null
 where u.email_confirmed_at is not null and u.deleted_at is null;
$$;
revoke all on function private.blip_referral_member_metrics() from public,anon,authenticated;
grant execute on function private.blip_referral_member_metrics() to service_role;

create or replace function public.blip_referral_program_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cfg public.blip_referral_settings%rowtype; metrics jsonb; activated bigint;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501'; end if;
 select * into cfg from public.blip_referral_settings where singleton=true;
 if not found then raise exception 'Referral program not configured' using errcode='55000';end if;
 metrics := private.blip_referral_member_metrics();
 activated := coalesce((metrics->>'activated_members')::bigint,0);
 return jsonb_build_object(
  'enabled',cfg.enabled,
  'accepting_referrals',cfg.enabled and
     (cfg.target_activated_members=0 or activated<cfg.target_activated_members),
  'target_reached',cfg.target_activated_members>0 and activated>=cfg.target_activated_members,
  'target_activated_members',cfg.target_activated_members,
  'activated_members',activated,
  'recent_signins_30d',coalesce((metrics->>'recent_signins_30d')::bigint,0),
  'milestone_size',10, 'cash_payouts_enabled',false,
  'updated_at',cfg.updated_at
 );
end $$;
revoke all on function public.blip_referral_program_status() from public,anon,authenticated;
grant execute on function public.blip_referral_program_status() to service_role;

-- Lock the settings row so founder pause and new claims cannot race.
create or replace function public.blip_referral_claim(p_user uuid,p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg public.blip_referral_settings%rowtype;
 metrics jsonb; joined_at timestamptz; verified_at timestamptz;
 owner uuid; owner_created timestamptz; owner_verified timestamptz;
 member_age integer; onboarded_at timestamptz;
 existing_code text;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 if p_user is null or coalesce(p_code,'') !~ '^BL[0-9A-F]{12}$'
 then raise exception 'Enter a valid referral code' using errcode='22023';end if;
 select code_used into existing_code from public.blip_referrals where referred_user_id=p_user;
 if found then return jsonb_build_object('status','already_recorded');end if;
 select * into cfg from public.blip_referral_settings where singleton=true for update;
 if not found or cfg.enabled is not true
 then raise exception 'New referrals are paused' using errcode='55000';end if;
 metrics := private.blip_referral_member_metrics();
 if cfg.target_activated_members>0
   and coalesce((metrics->>'activated_members')::bigint,0)>=cfg.target_activated_members
 then raise exception 'Referral target has been reached' using errcode='55000';end if;
 select created_at,email_confirmed_at into joined_at,verified_at
 from auth.users where id=p_user and deleted_at is null;
 if joined_at is null or verified_at is null or joined_at < now()-interval '14 days'
 then raise exception 'Only recently created, verified accounts can apply a code' using errcode='22023';end if;
 select age_years,completed_at into member_age,onboarded_at
 from public.member_onboarding where user_id=p_user;
 if onboarded_at is null or member_age is null or member_age<18
 then raise exception 'Referral attribution requires completed adult onboarding' using errcode='22023';end if;
 select c.owner_id,u.created_at,u.email_confirmed_at
 into owner,owner_created,owner_verified
 from public.blip_referral_codes c
 join public.profiles p on p.id=c.owner_id and p.account_status='active'
 join auth.users u on u.id=c.owner_id and u.deleted_at is null
 where c.code=p_code;
 if owner is null or owner=p_user or owner_verified is null or owner_created>=joined_at
 then raise exception 'The code cannot be applied to this account' using errcode='22023';end if;
 insert into public.blip_referrals(referred_user_id,referrer_id,code_used)
 values(p_user,owner,p_code)
 on conflict(referred_user_id) do nothing;
 if not found then return jsonb_build_object('status','already_recorded'); end if;
 return jsonb_build_object('status','pending','message','Attribution saved; no cash reward has been earned');
end $$;
revoke all on function public.blip_referral_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.blip_referral_claim(uuid,text) to service_role;

create or replace function public.blip_referral_consume_attempt(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare attempts_now integer;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 insert into private.blip_referral_claim_attempts(user_id,attempt_day,attempts)
 values(p_user,current_date,1)
 on conflict(user_id,attempt_day) do update set
 attempts=private.blip_referral_claim_attempts.attempts+1
 where private.blip_referral_claim_attempts.attempts<8
 returning attempts into attempts_now;
 return found;
end $$;
revoke all on function public.blip_referral_consume_attempt(uuid) from public,anon,authenticated;
grant execute on function public.blip_referral_consume_attempt(uuid) to service_role;

create or replace function public.blip_referral_admin_save(
 p_actor uuid,p_enabled boolean,p_target integer,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_role text; updated public.blip_referral_settings%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 select role into current_role from public.profiles
 where id=p_actor and account_status='active' for share;
 if current_role is distinct from 'super'
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

-- No financial tables, cash balance, or withdrawal RPC. The initial program is OFF.
