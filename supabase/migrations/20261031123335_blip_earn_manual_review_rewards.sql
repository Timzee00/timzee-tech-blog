-- Blip Earn phase B: founder-funded manual cash/airtime rewards, not a gateway.
-- All members are adults; qualification is evidence-based and requires human approval.
alter table public.blip_referrals
 add column if not exists reviewed_by uuid references public.profiles(id),
 add column if not exists review_note text,
 add column if not exists evidence_days smallint not null default 0;

create table if not exists public.blip_reward_controls (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 max_awards integer not null default 0 check(max_awards between 0 and 1000),
 official_chat_account uuid references public.profiles(id),
 winners_channel_url text check(winners_channel_url is null or (length(winners_channel_url)<=350 and winners_channel_url ~ '^https://[^[:space:]]+$')),
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
insert into public.blip_reward_controls(singleton,enabled,max_awards) values(true,false,0)
 on conflict(singleton) do nothing;
alter table public.blip_reward_controls enable row level security;
revoke all on public.blip_reward_controls from public,anon,authenticated;
grant select,update on public.blip_reward_controls to service_role;

create table if not exists public.blip_manual_rewards (
 id uuid primary key default gen_random_uuid(),
 referrer_id uuid not null references public.profiles(id) on delete cascade,
 milestone_no integer not null check(milestone_no between 1 and 100000),
 amount_naira integer not null default 1000 check(amount_naira=1000),
 status text not null default 'available' check(status in ('available','requested','paid')),
 delivery_method text check(delivery_method is null or delivery_method in ('bank','airtime')),
 requested_at timestamptz,
 paid_at timestamptz,
 paid_by uuid references public.profiles(id),
 confirmation_note text,
 public_consent_at timestamptz,
 published_at timestamptz,
 published_by uuid references public.profiles(id),
 public_alias text check(public_alias is null or public_alias ~ '^[A-Za-z0-9_]{3,32}$'),
 updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint blip_manual_rewards_unique_milestone unique(referrer_id,milestone_no),
 constraint blip_manual_rewards_paid_consistency check(status<>'paid' or (paid_at is not null and paid_by is not null)),
 constraint blip_manual_rewards_request_consistency check(status='available' or (requested_at is not null and delivery_method is not null)),
 constraint blip_manual_rewards_public_consistency check(published_at is null or
   (status='paid' and public_consent_at is not null and public_alias is not null))
);
create index if not exists blip_manual_rewards_owner_idx on public.blip_manual_rewards(referrer_id,created_at desc);
create index if not exists blip_manual_rewards_status_idx on public.blip_manual_rewards(status,requested_at desc);
create index if not exists blip_manual_rewards_public_idx on public.blip_manual_rewards(published_at desc)
 where published_at is not null;
alter table public.blip_manual_rewards enable row level security;
revoke all on public.blip_manual_rewards from public,anon,authenticated;
grant select,insert,update on public.blip_manual_rewards to service_role;

create table if not exists private.blip_reward_audit (
 id bigint generated always as identity primary key,
 event_type text not null,
 actor_id uuid,
 reward_id uuid,
 referrer_id uuid,
 referral_user_id uuid,
 previous jsonb,
 current jsonb,
 explanation text,
 created_at timestamptz not null default now()
);
revoke all on private.blip_reward_audit from public,anon,authenticated;
grant select,insert on private.blip_reward_audit to service_role;
grant usage,select on sequence private.blip_reward_audit_id_seq to service_role;

create or replace function private.blip_reward_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into private.blip_reward_audit(event_type,actor_id,reward_id,referrer_id,referral_user_id,previous,current,explanation)
 values(TG_TABLE_NAME||':'||TG_OP,
  case when TG_TABLE_NAME='blip_referrals' then (case when TG_OP='UPDATE' then new.reviewed_by else null end)
   else (case when TG_TABLE_NAME='blip_reward_controls' then new.updated_by else new.updated_by end) end,
  case when TG_TABLE_NAME='blip_manual_rewards' then new.id else null end,
  case when TG_TABLE_NAME='blip_manual_rewards' then new.referrer_id
       when TG_TABLE_NAME='blip_referrals' then new.referrer_id else null end,
  case when TG_TABLE_NAME='blip_referrals' then new.referred_user_id else null end,
  case when TG_OP='INSERT' then null else to_jsonb(old) end,
  to_jsonb(new),
  case when TG_TABLE_NAME='blip_referrals' then new.review_note
       when TG_TABLE_NAME='blip_manual_rewards' then new.confirmation_note
       else null end);
 return new;
end $$;
revoke all on function private.blip_reward_audit_change() from public,anon,authenticated;
drop trigger if exists blip_reward_record_audit on public.blip_manual_rewards;
create trigger blip_reward_record_audit after insert or update on public.blip_manual_rewards
 for each row execute function private.blip_reward_audit_change();
drop trigger if exists blip_reward_config_audit on public.blip_reward_controls;
create trigger blip_reward_config_audit after update on public.blip_reward_controls
 for each row execute function private.blip_reward_audit_change();
drop trigger if exists blip_referral_decision_audit on public.blip_referrals;
create trigger blip_referral_decision_audit after update of status on public.blip_referrals
 for each row execute function private.blip_reward_audit_change();

-- Ordinary users cannot call ANY of these RPCs. The Netlify endpoint verifies
-- a real Supabase session and super-admin profile status before service RPC.
create or replace function private.blip_reward_require_super(p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 if not exists(select 1 from public.profiles p where p.id=p_actor
  and p.role='super' and p.account_status='active')
 then raise exception 'Super Admin required' using errcode='42501';end if;
end $$;
revoke all on function private.blip_reward_require_super(uuid) from public,anon,authenticated;
grant execute on function private.blip_reward_require_super(uuid) to service_role;

-- DB-backed evidence is more reliable than browser clicks / page-open counts.
-- At least 3 distinct UTC dates with persisted social actions AFTER attribution.
-- Bounded to 100 recent events per activity source to avoid heavy historical scans.
create or replace function private.blip_reward_activity(p_user uuid,p_since timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('active_days',count(distinct day_of_action),
  'engagement_events',count(*))
 from (
  (select (v.created_at at time zone 'UTC')::date day_of_action
   from public.video_likes v where v.user_id=p_user and v.created_at>=p_since
   order by v.created_at desc limit 100)
  union all
  (select (l.created_at at time zone 'UTC')::date
   from public.post_likes l where l.user_id=p_user and l.created_at>=p_since
   order by l.created_at desc limit 100)
  union all
  (select (v.created_at at time zone 'UTC')::date
   from public.community_thread_votes v where v.user_id=p_user and v.created_at>=p_since
   order by v.created_at desc limit 100)
  union all
  (select (c.created_at at time zone 'UTC')::date
   from public.video_comments c where c.user_id=p_user and c.created_at>=p_since
   order by c.created_at desc limit 100)
  union all
  (select (c.created_at at time zone 'UTC')::date
   from public.comments c where c.author_id=p_user and c.created_at>=p_since and c.status='approved'
   order by c.created_at desc limit 100)
  union all
  (select (t.created_at at time zone 'UTC')::date
   from public.community_threads t where t.author_id=p_user and t.created_at>=p_since and t.status='published'
   order by t.created_at desc limit 100)
  union all
  (select (p.created_at at time zone 'UTC')::date
   from public.posts p where p.author_id=p_user and p.created_at>=p_since and p.status='published'
   order by p.created_at desc limit 100)
 ) activities;
$$;
revoke all on function private.blip_reward_activity(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.blip_reward_activity(uuid,timestamptz) to service_role;

-- Limit the cost of per-member referral verification.
create index if not exists blip_activity_video_likes on public.video_likes(user_id,created_at desc);
create index if not exists blip_activity_post_likes on public.post_likes(user_id,created_at desc);
create index if not exists blip_activity_community_votes on public.community_thread_votes(user_id,created_at desc);
create index if not exists blip_activity_video_comments on public.video_comments(user_id,created_at desc);
create index if not exists blip_activity_comments on public.comments(author_id,created_at desc) where status='approved';
create index if not exists blip_activity_threads on public.community_threads(author_id,created_at desc) where status='published';
create index if not exists blip_activity_posts on public.posts(author_id,created_at desc) where status='published';

-- Finance configuration is separate from the referral ON/OFF switch.
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

-- Idempotently create awards for qualifying milestones. The config lock and
-- unique(referrer,milestone) prevent awards above the founder's hard budget.
create or replace function public.blip_reward_mint(p_actor uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg public.blip_reward_controls%rowtype; qualified int;
 milestone int; minted int:=0; existing int; total_count int;
 age int;
begin
 perform private.blip_reward_require_super(p_actor);
 select * into cfg from public.blip_reward_controls where singleton=true for update;
 if not cfg.enabled or cfg.max_awards<1
 then return jsonb_build_object('created',0,'reason','Rewards funding is paused');end if;
 select m.age_years into age from public.member_onboarding m join public.profiles p
 on p.id=m.user_id and p.account_status='active'
 where m.user_id=p_owner and m.completed_at is not null;
 if age is null or age<18 then
  return jsonb_build_object('created',0,'reason','Referrer has not completed adult onboarding');end if;
 select count(*) into qualified from public.blip_referrals r
 where r.referrer_id=p_owner and r.status='qualified';
 select count(*) into total_count from public.blip_manual_rewards;
 if total_count>=cfg.max_awards then
  return jsonb_build_object('created',0,'reason','Founder reward cap reached');end if;
 for milestone in 1..least(qualified/10,1000) loop
  select count(*) into existing from public.blip_manual_rewards a
  where a.referrer_id=p_owner and a.milestone_no=milestone;
  if existing=0 then
    if total_count>=cfg.max_awards then exit;end if;
    insert into public.blip_manual_rewards(referrer_id,milestone_no,amount_naira,updated_by)
    values(p_owner,milestone,1000,p_actor);
    minted:=minted+1;
    total_count:=total_count+1;
  end if;
 end loop;
 return jsonb_build_object('created',minted,'qualified',qualified,
  'award_cap',cfg.max_awards,'total_awards',total_count);
end $$;
revoke all on function public.blip_reward_mint(uuid,uuid) from public,anon,authenticated;
grant execute on function public.blip_reward_mint(uuid,uuid) to service_role;

create or replace function public.blip_referral_review(
 p_actor uuid,p_referred uuid,p_decision text,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare referral public.blip_referrals%rowtype; proof jsonb;
 age int; confirmed timestamptz; user_state text;
begin
 perform private.blip_reward_require_super(p_actor);
 if p_decision not in ('qualified','rejected') or
  length(btrim(coalesce(p_reason,'')))<12 or length(p_reason)>500
 then raise exception 'Provide a valid decision and explanation (12-500 characters)' using errcode='22023';end if;
 select * into referral from public.blip_referrals
 where referred_user_id=p_referred for update;
 if not found then raise exception 'Referral does not exist' using errcode='22023';end if;
 if referral.status<>'pending'
 then raise exception 'Referral already reviewed; never double approve' using errcode='55000';end if;
 proof:=private.blip_reward_activity(p_referred,referral.created_at);
 if p_decision='qualified' then
  select m.age_years,u.email_confirmed_at,p.account_status
  into age,confirmed,user_state
  from auth.users u
  join public.profiles p on p.id=u.id
  join public.member_onboarding m on m.user_id=u.id and m.completed_at is not null
  where u.id=p_referred and u.deleted_at is null;
  if age is null or age<18 or confirmed is null or user_state is distinct from 'active'
  then raise exception 'Active verified adult onboarding required' using errcode='55000';end if;
  if coalesce((proof->>'active_days')::int,0)<3 or
    coalesce((proof->>'engagement_events')::int,0)<3
  then raise exception 'Three distinct activity days are required for qualification' using errcode='55000';end if;
 end if;
 update public.blip_referrals
 set status=p_decision,reviewed_at=now(),reviewed_by=p_actor,
 review_note=left(btrim(p_reason),500),
 evidence_days=least(32767,coalesce((proof->>'active_days')::int,0))
 where referred_user_id=p_referred;
 if p_decision='qualified' then
  perform public.blip_reward_mint(p_actor,referral.referrer_id);
 end if;
 return jsonb_build_object('status',p_decision,'activity',proof,'reviewed',true);
end $$;
revoke all on function public.blip_referral_review(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.blip_referral_review(uuid,uuid,text,text) to service_role;

create or replace function public.blip_reward_member_request(
 p_user uuid,p_award uuid,p_method text,p_consent boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare award public.blip_manual_rewards%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 if p_method not in ('bank','airtime') or p_consent is null
 then raise exception 'Choose bank or airtime and public listing preference' using errcode='22023';end if;
 if not exists(select 1 from public.profiles
  where id=p_user and account_status='active')
 then raise exception 'Active member account required' using errcode='42501';end if;
 select * into award from public.blip_manual_rewards
 where id=p_award and referrer_id=p_user for update;
 if not found then raise exception 'Reward record unavailable' using errcode='22023';end if;
 if award.status='requested' or award.status='paid'
 then return jsonb_build_object('status',award.status,'already_recorded',true);end if;
 if award.status<>'available' then raise exception 'Reward cannot be requested' using errcode='55000';end if;
 update public.blip_manual_rewards set status='requested',delivery_method=p_method,
  requested_at=now(), public_consent_at=case when p_consent then now() else null end,
  updated_by=p_user,updated_at=now()
 where id=p_award;
 return jsonb_build_object('status','requested','message',
   'Request saved. Contact official Blipmood staff privately; payment is manual.');
end $$;
revoke all on function public.blip_reward_member_request(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.blip_reward_member_request(uuid,uuid,text,boolean) to service_role;

create or replace function public.blip_reward_member_consent(p_user uuid,p_award uuid,p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare award public.blip_manual_rewards%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 if p_consent is null then raise exception 'Consent choice required' using errcode='22023';end if;
 select * into award from public.blip_manual_rewards
 where id=p_award and referrer_id=p_user and status in ('requested','paid') for update;
 if not found then raise exception 'Reward record unavailable' using errcode='22023';end if;
 update public.blip_manual_rewards set
  public_consent_at=case when p_consent then coalesce(public_consent_at,now()) else null end,
  published_at=case when p_consent then published_at else null end,
  published_by=case when p_consent then published_by else null end,
  public_alias=case when p_consent then public_alias else null end,
  updated_by=p_user,updated_at=now()
 where id=p_award;
 return jsonb_build_object('consented',p_consent,'published',p_consent and award.published_at is not null);
end $$;
revoke all on function public.blip_reward_member_consent(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.blip_reward_member_consent(uuid,uuid,boolean) to service_role;

create or replace function public.blip_reward_mark_paid(p_actor uuid,p_award uuid,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare award public.blip_manual_rewards%rowtype;
begin
 perform private.blip_reward_require_super(p_actor);
 if char_length(btrim(coalesce(p_note,'')))<12 or char_length(p_note)>500
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

create or replace function public.blip_reward_publish_winner(p_actor uuid,p_award uuid,p_publish boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare award public.blip_manual_rewards%rowtype; alias_text text;
begin
 perform private.blip_reward_require_super(p_actor);
 if p_publish is null then raise exception 'Publication choice required' using errcode='22023';end if;
 select * into award from public.blip_manual_rewards where id=p_award for update;
 if not found then raise exception 'Reward record unavailable' using errcode='22023';end if;
 if p_publish and (award.status<>'paid' or award.public_consent_at is null)
 then raise exception 'Only consenting paid recipients may be published' using errcode='55000';end if;
 if p_publish then
  select username into alias_text from public.profiles
   where id=award.referrer_id and account_status='active';
  if alias_text is null or alias_text !~ '^[A-Za-z0-9_]{3,32}$'
  then raise exception 'A valid public username is required' using errcode='55000';end if;
 end if;
 update public.blip_manual_rewards set
  published_at=case when p_publish then coalesce(published_at,now()) else null end,
  published_by=case when p_publish then p_actor else null end,
  public_alias=case when p_publish then alias_text else null end,
  updated_by=p_actor,updated_at=now() where id=p_award;
 return jsonb_build_object('published',p_publish);
end $$;
revoke all on function public.blip_reward_publish_winner(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.blip_reward_publish_winner(uuid,uuid,boolean) to service_role;

create or replace function public.blip_reward_review_queue(p_actor uuid,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out_data jsonb;
begin
 perform private.blip_reward_require_super(p_actor);
 select coalesce(jsonb_agg(
  jsonb_build_object('referred_id',q.referred_user_id,'referred_username',coalesce(q.invitee_username,'member'),
  'inviter_id',q.referrer_id,'inviter_username',coalesce(q.inviter_username,'member'),
  'claimed_at',q.created_at,'active_days',coalesce((q.activity->>'active_days')::integer,0),
  'engagement_events',coalesce((q.activity->>'engagement_events')::integer,0))
  order by q.created_at asc),'[]'::jsonb) into out_data
 from (
  select r.referred_user_id,r.referrer_id,r.created_at,
   p.username as invitee_username,ref.username as inviter_username,
   private.blip_reward_activity(r.referred_user_id,r.created_at) as activity
  from public.blip_referrals r
  left join public.profiles p on p.id=r.referred_user_id
  left join public.profiles ref on ref.id=r.referrer_id
  where r.status='pending'
  order by r.created_at asc limit least(greatest(coalesce(p_limit,20),1),30)
 ) q;
 return out_data;
end $$;
revoke all on function public.blip_reward_review_queue(uuid,integer) from public,anon,authenticated;
grant execute on function public.blip_reward_review_queue(uuid,integer) to service_role;

create or replace function public.blip_reward_admin_queue(p_actor uuid,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out_data jsonb;
begin
 perform private.blip_reward_require_super(p_actor);
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',q.id,'username',coalesce(q.username,'member'),
  'milestone',q.milestone_no,'amount_naira',q.amount_naira,
  'status',q.status,'method',q.delivery_method,
  'consent',q.public_consent_at is not null,
  'published',q.published_at is not null,
  'requested_at',q.requested_at,'paid_at',q.paid_at,
  'created_at',q.created_at) order by q.created_at desc),'[]'::jsonb)
 into out_data from (
  select a.*,p.username from public.blip_manual_rewards a
  join public.profiles p on p.id=a.referrer_id
  order by (case when a.status='requested' then 0 when a.status='available' then 1 else 2 end),
    a.created_at desc
  limit least(greatest(coalesce(p_limit,20),1),40)
 ) q;
 return out_data;
end $$;
revoke all on function public.blip_reward_admin_queue(uuid,integer) from public,anon,authenticated;
grant execute on function public.blip_reward_admin_queue(uuid,integer) to service_role;

create or replace function public.blip_reward_winners(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out_data jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role'
 then raise exception 'Server access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'username',w.public_alias,'milestone',w.milestone_no,'amount_naira',w.amount_naira,
  'published_at',w.published_at) order by w.published_at desc),'[]'::jsonb)
 into out_data
 from (select public_alias,milestone_no,amount_naira,published_at
       from public.blip_manual_rewards
       where published_at is not null and status='paid' and public_consent_at is not null
       order by published_at desc
       limit least(greatest(coalesce(p_limit,20),1),50)) w;
 return out_data;
end $$;
revoke all on function public.blip_reward_winners(integer) from public,anon,authenticated;
grant execute on function public.blip_reward_winners(integer) to service_role;

-- No automatic transfers, bank account tables, OTP collection or payout gateway.
-- Founder-funded rewards are capped and must be marked paid by a verified Super Admin.
