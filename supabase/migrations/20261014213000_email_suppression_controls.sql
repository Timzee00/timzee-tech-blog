-- Suppress invalid/complained-about recipient addresses before worker sending.
create table if not exists private.email_suppressions (
  email text primary key,
  reason text not null check (reason in ('hard_bounce','spam','invalid','blocked','manual')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.email_suppressions enable row level security;
revoke all on private.email_suppressions from public,anon,authenticated;
grant select,insert,update on private.email_suppressions to service_role;

create or replace function public.register_email_suppression(p_email text,p_reason text)
returns boolean language plpgsql security definer set search_path to pg_catalog,private
as $body$
declare e text := lower(trim(coalesce(p_email,'')));
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if length(e) > 320 or e !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then return false; end if;
  if p_reason not in ('hard_bounce','spam','invalid','blocked','manual') then return false; end if;
  insert into private.email_suppressions(email,reason) values(e,p_reason)
  on conflict(email) do update set reason=excluded.reason,updated_at=now();
  update private.email_jobs
  set status='suppressed',last_error='Address suppressed',lease_until=null,updated_at=now()
  where recipient_email=e and status='pending';
  return true;
end $body$;
revoke all on function public.register_email_suppression(text,text) from public,anon,authenticated;
grant execute on function public.register_email_suppression(text,text) to service_role;

create or replace function public.is_email_suppressed(p_email text)
returns boolean language plpgsql stable security definer set search_path to pg_catalog,private
as $body$
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return exists(select 1 from private.email_suppressions where email=lower(trim(coalesce(p_email,''))));
end $body$;
revoke all on function public.is_email_suppressed(text) from public,anon,authenticated;
grant execute on function public.is_email_suppressed(text) to service_role;

create or replace function public.suppress_email_job(p_id uuid)
returns boolean language plpgsql security definer set search_path to pg_catalog,private
as $body$
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update private.email_jobs set status='suppressed',last_error='Recipient is suppressed',
    lease_until=null,updated_at=now()
  where id=p_id and status='processing';
  return found;
end $body$;
revoke all on function public.suppress_email_job(uuid) from public,anon,authenticated;
grant execute on function public.suppress_email_job(uuid) to service_role;
