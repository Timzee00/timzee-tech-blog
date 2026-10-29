-- One cheap public-profile lookup per author batch; never N+1 company queries.
alter table public.public_profiles add column if not exists primary_org_name text;
alter table public.public_profiles add column if not exists primary_org_logo_url text;
alter table public.public_profiles add column if not exists primary_org_title text;

create or replace function private.refresh_public_affiliation(p_user uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_name text; v_logo text; v_title text;
begin
 select o.name,o.logo_url,a.title into v_name,v_logo,v_title
 from public.identity_affiliations a
 join public.identity_organizations o on o.id=a.organization_id
 where a.user_id=p_user and a.status='active' and o.status='verified'
 order by a.accepted_at desc nulls last,a.created_at desc limit 1;
 update public.public_profiles
 set primary_org_name=v_name,primary_org_logo_url=v_logo,primary_org_title=v_title
 where id=p_user and (
   primary_org_name is distinct from v_name or
   primary_org_logo_url is distinct from v_logo or
   primary_org_title is distinct from v_title
 );
end $$;
revoke all on function private.refresh_public_affiliation(uuid) from public,anon,authenticated;

create or replace function private.identity_affiliation_public_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 perform private.refresh_public_affiliation(coalesce(new.user_id,old.user_id));
 if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
   perform private.refresh_public_affiliation(old.user_id);
 end if;
 return coalesce(new,old);
end $$;
revoke all on function private.identity_affiliation_public_trigger() from public,anon,authenticated;
drop trigger if exists identity_affiliation_public_sync on public.identity_affiliations;
create trigger identity_affiliation_public_sync after insert or update or delete
on public.identity_affiliations for each row execute function private.identity_affiliation_public_trigger();

create or replace function private.identity_organization_public_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid;
begin
 if tg_op='UPDATE' and old.status is not distinct from new.status and
    old.name is not distinct from new.name and
    old.logo_url is not distinct from new.logo_url then return new; end if;
 for uid in select distinct user_id from public.identity_affiliations where organization_id=new.id loop
   perform private.refresh_public_affiliation(uid);
 end loop;
 return new;
end $$;
revoke all on function private.identity_organization_public_trigger() from public,anon,authenticated;
drop trigger if exists identity_organization_public_sync on public.identity_organizations;
create trigger identity_organization_public_sync after update of status,name,logo_url
on public.identity_organizations for each row execute function private.identity_organization_public_trigger();

-- Existing accepted affiliates (none expected at initial launch) receive the
-- same trusted display cache, and only the approved organization fields.
do $$ declare uid uuid; begin
 for uid in select distinct user_id from public.identity_affiliations loop
   perform private.refresh_public_affiliation(uid);
 end loop;
end $$;
