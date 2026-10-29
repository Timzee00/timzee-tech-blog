-- Grey marks require verified public office, not a political opinion or title.
-- Additive: original subscription/creator tiers remain untouched.
create table if not exists public.identity_official_designations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.profiles(id) on delete cascade,
 badge_kind text not null default 'government' check(badge_kind='government'),
 office_title text not null check(char_length(btrim(office_title)) between 4 and 130),
 issuer_name text not null check(char_length(btrim(issuer_name)) between 4 and 160),
 evidence_note text not null check(char_length(btrim(evidence_note)) between 50 and 1600),
 reviewed_by uuid not null references public.profiles(id),
 status text not null default 'active' check(status in ('active','revoked')),
 reviewed_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists identity_official_designations_status_idx
 on public.identity_official_designations(status,user_id);
create index if not exists identity_official_designations_reviewer_idx
 on public.identity_official_designations(reviewed_by);
alter table public.identity_official_designations enable row level security;
revoke all on public.identity_official_designations from anon,authenticated;
grant select,insert,update on public.identity_official_designations to authenticated;
drop policy if exists "Only super administrators review public officials" on public.identity_official_designations;
create policy "Only super administrators review public officials" on public.identity_official_designations
for all to authenticated using ((select public.has_role_secure('super')))
with check ((select public.has_role_secure('super')));
alter table public.public_profiles
  add column if not exists official_badge_kind text,
  add column if not exists official_badge_title text;
revoke update(official_badge_kind,official_badge_title) on public.public_profiles from anon,authenticated;
create or replace function private.sync_official_badge_for_user(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_kind text;v_title text;
begin
 select d.badge_kind,d.office_title into v_kind,v_title
 from public.identity_official_designations d
 join public.profiles p on p.id=d.user_id
 where d.user_id=p_user_id and d.status='active'
 and p.is_verified=true
 and (p.verification_expires_at is null or p.verification_expires_at>now())
 limit 1;
 update public.public_profiles
 set official_badge_kind=v_kind,official_badge_title=v_title
 where id=p_user_id and
 (official_badge_kind is distinct from v_kind or official_badge_title is distinct from v_title);
end $$;
revoke all on function private.sync_official_badge_for_user(uuid) from public,anon,authenticated;
create or replace function private.sync_official_badge_trg()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 perform private.sync_official_badge_for_user(coalesce(new.user_id,old.user_id));
 return coalesce(new,old);
end $$;
revoke all on function private.sync_official_badge_trg() from public,anon,authenticated;
drop trigger if exists identity_official_badge_sync on public.identity_official_designations;
create trigger identity_official_badge_sync after insert or update or delete
on public.identity_official_designations
for each row execute function private.sync_official_badge_trg();
drop trigger if exists identity_official_designations_audit on public.identity_official_designations;
create trigger identity_official_designations_audit after insert or update
on public.identity_official_designations
for each row execute function private.audit_identity_change();

-- An official designation requires actual verified identity first.
create or replace function private.guard_official_designation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.reviewed_by is distinct from auth.uid()
 or not public.has_role_secure('super') then
  raise exception 'Only a signed-in super administrator may review official claims' using errcode='42501';
 end if;
 if not exists(select 1 from public.profiles p
    where p.id=new.user_id and p.is_verified=true and
    (p.verification_expires_at is null or p.verification_expires_at>now()))
 then raise exception 'An active identity verification is required before an official designation' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function private.guard_official_designation() from public,anon,authenticated;
drop trigger if exists identity_official_designation_guard on public.identity_official_designations;
create trigger identity_official_designation_guard before insert or update
on public.identity_official_designations for each row
execute function private.guard_official_designation();

-- Retain only public, vetted office/title fields; evidence notes never enter public_profiles.
