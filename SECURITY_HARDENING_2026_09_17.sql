-- Applied to Supabase project duvbcwwprkzzyzikmcol on 2026-09-17.
-- This file documents production security changes made through Supabase migrations.

create or replace function public.has_role(p_role text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and lower(coalesce(pr.role, '')) = lower(p_role))
  or exists (select 1 from public.user_roles ur where ur.user_id = (select auth.uid()) and lower(coalesce(ur.role, '')) = lower(p_role))
  or (lower(p_role) = 'moderator' and exists (select 1 from public.moderators m where m.user_id = (select auth.uid()) and m.is_active = true));
$$;

create or replace function public.has_role_secure(p_role text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and lower(coalesce(pr.role, '')) = lower(p_role))
  or exists (select 1 from public.user_roles ur where ur.user_id = (select auth.uid()) and lower(coalesce(ur.role, '')) = lower(p_role))
  or (lower(p_role) = 'moderator' and exists (select 1 from public.moderators m where m.user_id = (select auth.uid()) and m.is_active = true));
$$;

create or replace function public.get_jwt_role()
returns text language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select lower(nullif(trim(pr.role), '')) from public.profiles pr where pr.id = (select auth.uid())),
    (select lower(nullif(trim(ur.role), '')) from public.user_roles ur where ur.user_id = (select auth.uid()) order by case lower(ur.role) when 'super' then 1 when 'admin' then 2 when 'moderator' then 3 when 'author' then 4 else 5 end, ur.created_at desc limit 1),
    case when exists (select 1 from public.moderators m where m.user_id = (select auth.uid()) and m.is_active = true) then 'moderator' end
  );
$$;

-- Remove all role decisions based on auth.jwt()->user_metadata.
-- Public visitors can read only published posts; owners/staff can read unpublished posts.
drop policy if exists "Public read posts" on public.posts;
drop policy if exists "Authors and staff read posts" on public.posts;
create policy "Authors and staff read posts" on public.posts for select to authenticated
using (auth.uid() = author_id or public.has_role_secure('admin') or public.has_role_secure('super') or public.has_role_secure('moderator'));

-- Internal trigger/helper functions are not public RPC endpoints.
revoke execute on function public.strip_user_metadata_role() from anon, authenticated;
revoke execute on function public.broadcast_changes_for_realtime() from anon, authenticated;
revoke execute on function public.apply_storage_objects_policies() from anon, authenticated;

-- Keep user-editable auth metadata free of authorization roles.
create or replace function public.strip_user_metadata_role()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if new.raw_user_meta_data is not null and new.raw_user_meta_data ? 'role' then
    new.raw_user_meta_data := new.raw_user_meta_data - 'role';
  end if;
  return new;
end;
$$;

-- Trigger installation/data cleanup was applied as a separate production migration.
