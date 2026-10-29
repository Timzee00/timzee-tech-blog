
-- Additive identity and recognition system. Existing verified tiers and subscriptions unchanged.
create table if not exists public.identity_organizations (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 2 and 120),
 logo_url text,
 website text,
 summary text,
 status text not null default 'pending' check (status in ('pending','verified','revoked')),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.identity_affiliations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 organization_id uuid not null references public.identity_organizations(id) on delete cascade,
 title text not null default 'Member' check (char_length(btrim(title)) between 2 and 90),
 status text not null default 'pending' check (status in ('pending','active','revoked')),
 accepted_at timestamptz,
 created_at timestamptz not null default now(),
 unique (user_id,organization_id)
);
create table if not exists public.identity_appointments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 role_code text not null check (role_code in ('product_lead','product_advisor','community_advisor','community_contributor')),
 specialty text check (char_length(coalesce(specialty,'')) <= 100),
 summary text check (char_length(coalesce(summary,'')) <= 500),
 status text not null default 'active' check (status in ('active','revoked')),
 granted_by uuid references public.profiles(id) on delete set null,
 granted_at timestamptz not null default now(),
 expires_at timestamptz,
 unique(user_id,role_code)
);
create table if not exists public.identity_awards (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 award_code text not null check (award_code in ('staff_pick','featured','platinum','product_contributor')),
 reason text not null check (char_length(btrim(reason)) between 15 and 800),
 source_url text check (char_length(coalesce(source_url,'')) <= 600),
 is_active boolean not null default true,
 granted_by uuid references public.profiles(id) on delete set null,
 awarded_at timestamptz not null default now(),
 expires_at timestamptz
);
create index if not exists identity_affiliations_public_idx on public.identity_affiliations(user_id,status);
create index if not exists identity_affiliations_org_idx on public.identity_affiliations(organization_id,status);
create index if not exists identity_appointments_public_idx on public.identity_appointments(user_id,status,expires_at);
create index if not exists identity_awards_public_idx on public.identity_awards(user_id,is_active,expires_at,awarded_at desc);
create index if not exists identity_organizations_owner_idx on public.identity_organizations(owner_user_id,status);
alter table public.identity_organizations enable row level security;
alter table public.identity_affiliations enable row level security;
alter table public.identity_appointments enable row level security;
alter table public.identity_awards enable row level security;
revoke all on public.identity_organizations,public.identity_affiliations,public.identity_appointments,public.identity_awards from anon,authenticated;
grant select on public.identity_organizations,public.identity_affiliations,public.identity_appointments,public.identity_awards to anon,authenticated;
grant insert,update on public.identity_organizations,public.identity_affiliations,public.identity_appointments,public.identity_awards to authenticated;
drop policy if exists "Identity organizations readable after verification" on public.identity_organizations;
create policy "Identity organizations readable after verification" on public.identity_organizations for select to anon,authenticated using (
 status='verified' or (select public.has_role_secure('super'))
);
drop policy if exists "Identity affiliations public or own pending" on public.identity_affiliations;
create policy "Identity affiliations public or own pending" on public.identity_affiliations for select to anon,authenticated using (
 (status='active' and exists(select 1 from public.identity_organizations o where o.id=organization_id and o.status='verified'))
 or user_id=(select auth.uid()) or (select public.has_role_secure('super'))
);
drop policy if exists "Identity appointments public" on public.identity_appointments;
create policy "Identity appointments public" on public.identity_appointments for select to anon,authenticated using (
 (status='active' and (expires_at is null or expires_at>now())) or user_id=(select auth.uid()) or (select public.has_role_secure('super'))
);
drop policy if exists "Identity awards public" on public.identity_awards;
create policy "Identity awards public" on public.identity_awards for select to anon,authenticated using (
 (is_active and (expires_at is null or expires_at>now())) or user_id=(select auth.uid()) or (select public.has_role_secure('super'))
);
drop policy if exists "Identity organizations staff insert" on public.identity_organizations;
create policy "Identity organizations staff insert" on public.identity_organizations for insert to authenticated with check ((select public.has_role_secure('super')));
drop policy if exists "Identity organizations staff update" on public.identity_organizations;
create policy "Identity organizations staff update" on public.identity_organizations for update to authenticated using ((select public.has_role_secure('super'))) with check ((select public.has_role_secure('super')));
drop policy if exists "Identity affiliations staff insert" on public.identity_affiliations;
create policy "Identity affiliations staff insert" on public.identity_affiliations for insert to authenticated with check ((select public.has_role_secure('super')));
drop policy if exists "Identity affiliations staff update" on public.identity_affiliations;
create policy "Identity affiliations staff update" on public.identity_affiliations for update to authenticated using ((select public.has_role_secure('super'))) with check ((select public.has_role_secure('super')));
drop policy if exists "Identity appointments staff insert" on public.identity_appointments;
create policy "Identity appointments staff insert" on public.identity_appointments for insert to authenticated with check ((select public.has_role_secure('super')));
drop policy if exists "Identity appointments staff update" on public.identity_appointments;
create policy "Identity appointments staff update" on public.identity_appointments for update to authenticated using ((select public.has_role_secure('super'))) with check ((select public.has_role_secure('super')));
drop policy if exists "Identity awards staff insert" on public.identity_awards;
create policy "Identity awards staff insert" on public.identity_awards for insert to authenticated with check ((select public.has_role_secure('super')));
drop policy if exists "Identity awards staff update" on public.identity_awards;
create policy "Identity awards staff update" on public.identity_awards for update to authenticated using ((select public.has_role_secure('super'))) with check ((select public.has_role_secure('super')));
-- The private audit log is not accessible to browser clients.
create table if not exists private.identity_decision_audit (
 id bigint generated always as identity primary key,
 actor_id uuid,
 entity text not null,
 entity_id uuid not null,
 action text not null,
 old_state jsonb,
 new_state jsonb,
 recorded_at timestamptz not null default now()
);
revoke all on private.identity_decision_audit from public,anon,authenticated;
create or replace function private.audit_identity_change() returns trigger language plpgsql security definer
 set search_path=pg_catalog,public,private as $$
begin
 insert into private.identity_decision_audit(actor_id,entity,entity_id,action,old_state,new_state)
 values (auth.uid(),tg_table_name,coalesce(new.id,old.id),tg_op,
   case when tg_op='INSERT' then null else to_jsonb(old) end,
   case when tg_op='DELETE' then null else to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function private.audit_identity_change() from public,anon,authenticated;
drop trigger if exists identity_organizations_audit on public.identity_organizations;
create trigger identity_organizations_audit after insert or update on public.identity_organizations for each row execute function private.audit_identity_change();
drop trigger if exists identity_affiliations_audit on public.identity_affiliations;
create trigger identity_affiliations_audit after insert or update on public.identity_affiliations for each row execute function private.audit_identity_change();
drop trigger if exists identity_appointments_audit on public.identity_appointments;
create trigger identity_appointments_audit after insert or update on public.identity_appointments for each row execute function private.audit_identity_change();
drop trigger if exists identity_awards_audit on public.identity_awards;
create trigger identity_awards_audit after insert or update on public.identity_awards for each row execute function private.audit_identity_change();
-- A member may accept ONLY an existing invitation to their own account.
create or replace function public.accept_identity_affiliation(p_affiliation_id uuid) returns boolean
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare invited uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select a.user_id into invited from public.identity_affiliations a
 join public.identity_organizations o on o.id=a.organization_id
 where a.id=p_affiliation_id and a.status='pending' and o.status='verified' for update of a;
 if invited is distinct from auth.uid() then raise exception 'No active invitation for this account' using errcode='42501'; end if;
 update public.identity_affiliations set status='active',accepted_at=now() where id=p_affiliation_id;
 return true;
end $$;
revoke all on function public.accept_identity_affiliation(uuid) from public,anon,authenticated;
grant execute on function public.accept_identity_affiliation(uuid) to authenticated;
-- One bounded request per profile page, never one request per post or comment.
create or replace function public.blipmood_public_identity(p_user_id uuid) returns jsonb
 language sql stable security invoker set search_path=pg_catalog,public as $$
select jsonb_build_object(
 'organizations',coalesce((
   select jsonb_agg(jsonb_build_object('name',name,'logo_url',logo_url,'website',website,'title',title,'organization_id',organization_id))
   from (select o.name,o.logo_url,o.website,a.title,a.organization_id
      from public.identity_affiliations a join public.identity_organizations o on o.id=a.organization_id
      where a.user_id=p_user_id and a.status='active' and o.status='verified'
      order by a.accepted_at desc nulls last limit 5) q
 ),'[]'::jsonb),
 'appointments',coalesce((
   select jsonb_agg(jsonb_build_object('role',role_code,'specialty',specialty,'summary',summary,'granted_at',granted_at))
   from (select role_code,specialty,summary,granted_at from public.identity_appointments
     where user_id=p_user_id and status='active' and (expires_at is null or expires_at>now())
     order by granted_at desc limit 5) q
 ),'[]'::jsonb),
 'awards',coalesce((
   select jsonb_agg(jsonb_build_object('code',award_code,'reason',reason,'source_url',source_url,'awarded_at',awarded_at))
   from (select award_code,reason,source_url,awarded_at from public.identity_awards
     where user_id=p_user_id and is_active=true and (expires_at is null or expires_at>now())
     order by awarded_at desc limit 8) q
 ),'[]'::jsonb)
);
$$;
revoke all on function public.blipmood_public_identity(uuid) from public;
grant execute on function public.blipmood_public_identity(uuid) to anon,authenticated;
