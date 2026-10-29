-- Genuine opt-in Advisor applications. Verification and moderation powers stay independent.
create table if not exists public.identity_advisor_applications(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 requested_role text not null check (requested_role in ('community_advisor','product_advisor')),
 specialty text not null check(char_length(btrim(specialty)) between 3 and 100),
 statement text not null check(char_length(btrim(statement)) between 80 and 2000),
 evidence_url text check(evidence_url is null or evidence_url ~ '^https://[^[:space:]]+$'),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid references public.profiles(id) on delete set null,
 review_note text,
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index if not exists identity_advisor_pending_idx
 on public.identity_advisor_applications(user_id,requested_role) where status='pending';
create index if not exists identity_advisor_queue_idx on public.identity_advisor_applications(status,created_at);
create index if not exists identity_advisor_reviewer_idx on public.identity_advisor_applications(reviewed_by) where reviewed_by is not null;
alter table public.identity_advisor_applications enable row level security;
revoke all on public.identity_advisor_applications from anon,authenticated;
grant select,insert,update on public.identity_advisor_applications to authenticated;
drop policy if exists "Advisor applicants see their reviews" on public.identity_advisor_applications;
create policy "Advisor applicants see their reviews" on public.identity_advisor_applications
 for select to authenticated using (user_id=(select auth.uid()) or (select public.has_role_secure('super')));
drop policy if exists "Advisor applicants submit only pending requests" on public.identity_advisor_applications;
create policy "Advisor applicants submit only pending requests" on public.identity_advisor_applications
 for insert to authenticated with check(
 user_id=(select auth.uid()) and status='pending' and
 reviewed_by is null and reviewed_at is null and review_note is null
 );
drop policy if exists "Only super reviews Advisor requests" on public.identity_advisor_applications;
create policy "Only super reviews Advisor requests" on public.identity_advisor_applications
 for update to authenticated using ((select public.has_role_secure('super')))
 with check ((select public.has_role_secure('super')));
drop trigger if exists identity_advisor_applications_audit on public.identity_advisor_applications;
create trigger identity_advisor_applications_audit
 after insert or update on public.identity_advisor_applications for each row
 execute function private.audit_identity_change();
create or replace function public.review_identity_advisor(
  p_application_id uuid,p_decision text,p_review_note text
) returns boolean language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare app public.identity_advisor_applications%rowtype;
begin
 if auth.uid() is null or not public.has_role_secure('super') then
   raise exception 'Super administrator required' using errcode='42501';
 end if;
 if p_decision not in ('approved','rejected') or
    char_length(btrim(coalesce(p_review_note,''))) not between 25 and 1200 then
   raise exception 'Review decision and detailed notes are required (25-1200 characters)' using errcode='22023';
 end if;
 select * into app from public.identity_advisor_applications
 where id=p_application_id and status='pending' for update;
 if not found then raise exception 'Application is no longer pending' using errcode='22023'; end if;
 if p_decision='approved' then
  insert into public.identity_appointments(
    user_id,role_code,specialty,summary,status,granted_by,granted_at
  ) values(
    app.user_id,app.requested_role,app.specialty,
    left(btrim(app.statement),500),'active',auth.uid(),now()
  ) on conflict(user_id,role_code) do update set
    specialty=excluded.specialty,summary=excluded.summary,status='active',
    granted_by=auth.uid(),granted_at=now(),expires_at=null;
 end if;
 update public.identity_advisor_applications
 set status=p_decision,reviewed_by=auth.uid(),review_note=btrim(p_review_note),reviewed_at=now()
 where id=p_application_id;
 return true;
end $$;
revoke all on function public.review_identity_advisor(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_identity_advisor(uuid,text,text) to authenticated;
