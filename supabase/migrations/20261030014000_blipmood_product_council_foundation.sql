-- Blipmood Product Council. Additive migration: never changes legacy verification or privileges.
-- Production application is gated on preview verification.
alter table public.identity_appointments drop constraint if exists identity_appointments_role_code_check;
alter table public.identity_appointments add constraint identity_appointments_role_code_check
 check (role_code in (
  'product_lead','product_advisor','community_advisor','community_contributor',
  'product_manager','beta_tester','research_contributor','design_contributor','launch_reviewer'
 ));

-- Roles come only from existing Super Admin-controlled identity appointments.
-- Invoker functions read only the current actor's appointments under existing RLS.
create or replace function public.council_has_role(p_codes text[])
returns boolean language sql stable security invoker
set search_path=pg_catalog,public as $$
 select (select public.has_role_secure('super')) or exists (
  select 1 from public.identity_appointments a
  where a.user_id=(select auth.uid()) and a.status='active'
    and (a.expires_at is null or a.expires_at>now())
    and a.role_code=any(p_codes)
 );
$$;
revoke all on function public.council_has_role(text[]) from public,anon;
grant execute on function public.council_has_role(text[]) to authenticated;

create or replace function public.council_is_member()
returns boolean language sql stable security invoker
set search_path=pg_catalog,public as $$
 select coalesce((select public.council_has_role(array[
 'product_lead','product_manager','product_advisor','community_advisor',
 'community_contributor','beta_tester','research_contributor','design_contributor','launch_reviewer'
 ])),false);
$$;
revoke all on function public.council_is_member() from public,anon;
grant execute on function public.council_is_member() to authenticated;

create or replace function public.council_can_manage()
returns boolean language sql stable security invoker
set search_path=pg_catalog,public as $$
 select coalesce((select public.council_has_role(array['product_lead','product_manager'])),false);
$$;
revoke all on function public.council_can_manage() from public,anon;
grant execute on function public.council_can_manage() to authenticated;

create table if not exists public.council_items(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in (
  'initiative','proposal','bug','feedback','mission','beta','session','research','release_review')),
 author_id uuid not null references public.profiles(id) on delete cascade,
 assignee_id uuid references public.profiles(id) on delete set null,
 title text not null check(char_length(btrim(title)) between 6 and 140),
 body text not null check(char_length(btrim(body)) between 15 and 5000),
 status text not null default 'proposed' check(status in (
  'proposed','triage','planned','in_progress','testing','approved','shipped','closed')),
 priority smallint not null default 2 check(priority between 1 and 4),
 due_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists council_items_kind_recent_idx on public.council_items(kind,created_at desc);
create index if not exists council_items_status_recent_idx on public.council_items(status,created_at desc);
create index if not exists council_items_assignee_idx on public.council_items(assignee_id,status) where assignee_id is not null;
alter table public.council_items enable row level security;
revoke all on public.council_items from anon,authenticated;
grant select,insert,update on public.council_items to authenticated;
create policy "Council members read approved workspaces" on public.council_items
 for select to authenticated using ((select public.council_is_member()));
create policy "Council approved authors create items" on public.council_items
 for insert to authenticated with check(
  author_id=(select auth.uid()) and (select public.council_is_member())
  and (kind in ('proposal','bug','feedback') or (select public.council_can_manage()))
 );
create policy "Council managers update work items" on public.council_items
 for update to authenticated using ((select public.council_can_manage()))
 with check ((select public.council_can_manage()));

create table if not exists public.council_comments(
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.council_items(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 2 and 1800),
 created_at timestamptz not null default now()
);
create index if not exists council_comments_item_idx on public.council_comments(item_id,created_at desc);
alter table public.council_comments enable row level security;
revoke all on public.council_comments from anon,authenticated;
grant select,insert on public.council_comments to authenticated;
create policy "Council members see discussion" on public.council_comments for select
 to authenticated using((select public.council_is_member()));
create policy "Council members contribute to discussion" on public.council_comments
 for insert to authenticated with check(
   author_id=(select auth.uid()) and (select public.council_is_member())
   and exists(select 1 from public.council_items i where i.id=item_id)
 );

create table if not exists public.council_votes(
 item_id uuid not null references public.council_items(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(item_id,user_id)
);
alter table public.council_votes enable row level security;
revoke all on public.council_votes from anon,authenticated;
grant select,insert,delete on public.council_votes to authenticated;
create policy "Council members see proposal votes" on public.council_votes
 for select to authenticated using ((select public.council_is_member()));
create policy "Council members can vote once" on public.council_votes
 for insert to authenticated with check(user_id=(select auth.uid())
 and (select public.council_is_member())
 and exists(select 1 from public.council_items i where i.id=item_id and i.kind in ('proposal','initiative')));
create policy "Council members remove own vote" on public.council_votes
 for delete to authenticated using(user_id=(select auth.uid()) and (select public.council_is_member()));

create table if not exists public.council_beta_enrollments(
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.council_items(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'invited' check(status in ('invited','accepted','declined','removed')),
 invited_by uuid references public.profiles(id) on delete set null,
 invited_at timestamptz not null default now(),
 responded_at timestamptz,
 unique(item_id,user_id)
);
create index if not exists council_beta_user_idx on public.council_beta_enrollments(user_id,status);
alter table public.council_beta_enrollments enable row level security;
revoke all on public.council_beta_enrollments from anon,authenticated;
grant select,insert,update on public.council_beta_enrollments to authenticated;
create policy "Council beta invite is private" on public.council_beta_enrollments
 for select to authenticated using(user_id=(select auth.uid()) or (select public.council_can_manage()));
create policy "Council managers invite test members" on public.council_beta_enrollments
 for insert to authenticated with check(
 (select public.council_can_manage()) and invited_by=(select auth.uid())
 and exists(select 1 from public.council_items where id=item_id and kind='beta')
 and exists(select 1 from public.identity_appointments where user_id=council_beta_enrollments.user_id
    and role_code='beta_tester' and status='active' and (expires_at is null or expires_at>now()))
 );
create policy "Council members respond to own beta invitations" on public.council_beta_enrollments
 for update to authenticated
 using((user_id=(select auth.uid()) and status='invited') or (select public.council_can_manage()))
 with check((user_id=(select auth.uid()) and status in('accepted','declined')) or (select public.council_can_manage()));

create table if not exists public.council_credits(
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.council_items(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 contribution text not null check(char_length(btrim(contribution)) between 5 and 280),
 published boolean not null default false,
 credited_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(item_id,user_id)
);
create index if not exists council_credits_public_idx on public.council_credits(user_id,published,created_at desc);
alter table public.council_credits enable row level security;
revoke all on public.council_credits from anon,authenticated;
grant select on public.council_credits to anon;
grant select,insert,update on public.council_credits to authenticated;
create policy "Only published contribution credits are public" on public.council_credits
 for select to anon,authenticated using(published or (select public.council_can_manage()));
create policy "Council managers document impact" on public.council_credits
 for insert to authenticated with check(
 (select public.council_can_manage()) and credited_by=(select auth.uid())
 and (published=false or (select public.council_has_role(array['product_lead'])))
 );
create policy "Only lead approves public credits" on public.council_credits
 for update to authenticated using((select public.council_has_role(array['product_lead'])))
 with check((select public.council_has_role(array['product_lead'])));

-- Immutable provenance and history make credits and work traceable.
create or replace function private.council_immutable_fields() returns trigger
language plpgsql set search_path=pg_catalog,public,private as $$
begin
 if tg_table_name='council_items' then
  if new.author_id is distinct from old.author_id or new.kind is distinct from old.kind
  or new.created_at is distinct from old.created_at then
   raise exception 'Council item provenance is immutable' using errcode='42501';
  end if;
  new.updated_at=now();
 elsif tg_table_name='council_beta_enrollments' then
  if new.user_id is distinct from old.user_id or new.item_id is distinct from old.item_id
  or new.invited_by is distinct from old.invited_by then
   raise exception 'Beta invitation identity is immutable' using errcode='42501';
  end if;
  if old.status='invited' and new.status in('accepted','declined') then new.responded_at=now(); end if;
 elsif tg_table_name='council_credits' then
  if new.item_id is distinct from old.item_id or new.user_id is distinct from old.user_id
     or new.credited_by is distinct from old.credited_by then
   raise exception 'Contribution credit provenance is immutable' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.council_immutable_fields() from public,anon,authenticated;
create trigger council_items_provenance before update on public.council_items for each row execute function private.council_immutable_fields();
create trigger council_beta_provenance before update on public.council_beta_enrollments for each row execute function private.council_immutable_fields();
create trigger council_credits_provenance before update on public.council_credits for each row execute function private.council_immutable_fields();

create table if not exists private.council_action_audit(
 id bigint generated always as identity primary key,
 actor_id uuid,
 entity text not null,
 entity_id uuid,
 action text not null,
 before_state jsonb,
 after_state jsonb,
 recorded_at timestamptz not null default now()
);
revoke all on private.council_action_audit from public,anon,authenticated;
create or replace function private.audit_council_action() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 insert into private.council_action_audit(actor_id,entity,entity_id,action,before_state,after_state)
 values(auth.uid(),tg_table_name,
  coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid),
  tg_op,case when tg_op='INSERT' then null else to_jsonb(old) end,
  case when tg_op='DELETE' then null else to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function private.audit_council_action() from public,anon,authenticated;
create trigger council_items_audit after insert or update on public.council_items for each row execute function private.audit_council_action();
create trigger council_comments_audit after insert on public.council_comments for each row execute function private.audit_council_action();
create trigger council_beta_audit after insert or update on public.council_beta_enrollments for each row execute function private.audit_council_action();
create trigger council_credits_audit after insert or update on public.council_credits for each row execute function private.audit_council_action();
