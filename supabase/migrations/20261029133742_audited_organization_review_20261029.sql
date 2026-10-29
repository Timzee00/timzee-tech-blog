-- Organization verification decisions require a documented super-admin review.
create table if not exists private.identity_review_notes (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.identity_organizations(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 decision text not null check (decision in ('verified','revoked')),
 reason text not null check (char_length(btrim(reason)) between 25 and 1500),
 created_at timestamptz not null default now()
);
revoke all on private.identity_review_notes from public,anon,authenticated;
create or replace function public.review_identity_organization(p_organization_id uuid,p_decision text,p_reason text)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null or not public.has_role_secure('super') then
   raise exception 'Super administrator required' using errcode='42501';
 end if;
 if p_decision not in ('verified','revoked') then
   raise exception 'Unsupported review decision' using errcode='22023';
 end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 25 and 1500 then
   raise exception 'Document identity evidence and decision rationale (25-1500 characters)' using errcode='22023';
 end if;
 update public.identity_organizations set status=p_decision,
   reviewed_at=now() where id=p_organization_id and status is distinct from p_decision;
 if not found then raise exception 'Organization not found or review status unchanged' using errcode='22023'; end if;
 insert into private.identity_review_notes(organization_id,actor_id,decision,reason)
 values(p_organization_id,auth.uid(),p_decision,btrim(p_reason));
 return true;
end $$;
revoke all on function public.review_identity_organization(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_identity_organization(uuid,text,text) to authenticated;