-- Profile FX Studio: additive and independent of verified cosmetics, cover photos and private demographics.
create table if not exists public.member_profile_effects(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 cover_effect text not null default 'none'
  check(cover_effect in ('none','storm','inferno','glitch','frost','void','sakura','aurora','stardust','hearts','fireflies','neon','halo','eclipse','diamond')),
 avatar_effect text not null default 'none'
  check(avatar_effect in ('none','storm','inferno','glitch','frost','void','sakura','aurora','stardust','hearts','fireflies','neon','halo','eclipse','diamond')),
 intensity smallint not null default 45 check(intensity between 0 and 100),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.member_profile_effects enable row level security;
revoke all on public.member_profile_effects from public,anon,authenticated;
grant select on public.member_profile_effects to anon,authenticated;
grant insert,update,delete on public.member_profile_effects to authenticated;
drop policy if exists "Read profile visual settings" on public.member_profile_effects;
create policy "Read profile visual settings" on public.member_profile_effects
for select to anon,authenticated using(true);
drop policy if exists "Members create their own profile effects" on public.member_profile_effects;
create policy "Members create their own profile effects" on public.member_profile_effects
for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists "Members update their own profile effects" on public.member_profile_effects;
create policy "Members update their own profile effects" on public.member_profile_effects
for update to authenticated using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid()));
drop policy if exists "Members delete their own profile effects" on public.member_profile_effects;
create policy "Members delete their own profile effects" on public.member_profile_effects
for delete to authenticated using(user_id=(select auth.uid()));
-- Enforce the new onboarding selection without rejecting any existing historical accounts.
-- NOT VALID still checks all new inserts and updates.
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.member_onboarding'::regclass
  and conname='member_onboarding_gender_avatar_consistent') then
  alter table public.member_onboarding
   add constraint member_onboarding_gender_avatar_consistent
   check(gender not in ('male','female') or avatar_style=gender) not valid;
 end if;
end $$;
