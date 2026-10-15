-- Early-stage abuse budget for public forms.
-- Forms still save submissions when the optional receipt is throttled.
-- Replace these static pilot thresholds with an operational control plane before scaling.
create index if not exists email_jobs_recipient_template_recent_idx
  on private.email_jobs(recipient_email,template,created_at desc);
create index if not exists email_jobs_created_recent_idx
  on private.email_jobs(created_at desc);

create or replace function private.enqueue_public_receipt()
returns trigger language plpgsql security definer
set search_path to pg_catalog,private as $body$
declare
  kind text;
  address text := lower(trim(coalesce(new.email,'')));
begin
  if tg_table_name = 'contact_requests' then kind := 'contact_received';
  elsif tg_table_name = 'support_requests' then kind := 'support_received';
  elsif tg_table_name = 'ad_applications' then kind := 'advertising_received';
  else return new;
  end if;
  if address = '' or length(address)>320 then return new; end if;
  if exists(select 1 from private.email_suppressions s where s.email=address) then return new; end if;
  -- Only one receipt of a given type per recipient per hour.
  perform pg_advisory_xact_lock(hashtextextended(address||':'||kind,71));
  if exists(
    select 1 from private.email_jobs j
    where j.recipient_email=address and j.template=kind
      and j.created_at > now()-interval '60 minutes'
  ) then return new; end if;
  -- Pilot cap: prevent an uncontrolled public-form backlog while the site is on
  -- a free transactional email quota. This limit is deliberately temporary.
  if (
    select count(*) from private.email_jobs j
    where j.created_at > now()-interval '24 hours'
  ) >= 150 then return new; end if;
  insert into private.email_jobs(event_key,template,recipient_email,payload)
  values(kind||':'||new.id::text,kind,address,
    jsonb_build_object('reference',new.id::text,'name',left(coalesce(new.name,''),120)))
  on conflict(event_key) do nothing;
  return new;
end $body$;
revoke all on function private.enqueue_public_receipt() from public,anon,authenticated;
