-- Audited, user-initiated staff replies to pre-existing inbound requests.
-- No actual email is sent by this migration; both Netlify gates remain off.
create table if not exists private.staff_email_replies (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id) on delete restrict,
 client_request_id uuid not null,
 request_kind text not null check(request_kind in ('contact','support','ads')),
 request_id uuid not null,
 recipient_email text not null,
 subject text not null,
 message text not null,
 status text not null default 'reserved'
   check(status in ('reserved','accepted','rejected','needs_review')),
 provider_id text,
 failure_category text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(actor_id,client_request_id)
);
create index if not exists staff_email_replies_recipient_recent_idx
 on private.staff_email_replies(recipient_email,created_at desc);
create index if not exists staff_email_replies_actor_recent_idx
 on private.staff_email_replies(actor_id,created_at desc);
alter table private.staff_email_replies enable row level security;
revoke all on private.staff_email_replies from public,anon,authenticated;
grant select,insert,update on private.staff_email_replies to service_role;

create or replace function public.claim_staff_email_reply(
 p_actor_id uuid,p_client_request_id uuid,p_kind text,p_request_id uuid,
 p_subject text,p_message text
) returns jsonb language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare recipient text; claimed uuid; previous uuid; count24 integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
   raise exception 'forbidden';
 end if;
 if p_actor_id is null or p_client_request_id is null or p_request_id is null
   or p_kind not in ('contact','support','ads')
   or length(trim(coalesce(p_subject,''))) not between 3 and 180
   or length(trim(coalesce(p_message,''))) not between 2 and 5000
   or p_subject ~ '[\r\n]' then raise exception 'Invalid email reply';
 end if;
 -- Serialize recipient and actor quota checks within concurrent send attempts.
 perform pg_advisory_xact_lock(hashtextextended('staff-reply:'||p_actor_id::text,0));
 select id into previous from private.staff_email_replies
 where actor_id=p_actor_id and client_request_id=p_client_request_id;
 if previous is not null then
   return jsonb_build_object('reserved',false,'reason','already_processed');
 end if;
 if p_kind='contact' then
   select lower(trim(email)) into recipient from public.contact_requests where id=p_request_id;
 elsif p_kind='support' then
   select lower(trim(email)) into recipient from public.support_requests where id=p_request_id;
 elsif p_kind='ads' then
   select lower(trim(email)) into recipient from public.ad_applications where id=p_request_id;
 end if;
 if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or length(recipient)>320 then raise exception 'Request has no deliverable email address';
 end if;
 if exists(select 1 from private.email_suppressions s where s.email=recipient) then
   return jsonb_build_object('reserved',false,'reason','suppressed');
 end if;
 select count(*) into count24 from private.staff_email_replies
 where actor_id=p_actor_id and created_at>now()-interval '24 hours';
 if count24>=40 then return jsonb_build_object('reserved',false,'reason','actor_limit'); end if;
 select count(*) into count24 from private.staff_email_replies
 where recipient_email=recipient and created_at>now()-interval '24 hours';
 if count24>=5 then return jsonb_build_object('reserved',false,'reason','recipient_limit'); end if;
 insert into private.staff_email_replies(actor_id,client_request_id,request_kind,
  request_id,recipient_email,subject,message)
 values(p_actor_id,p_client_request_id,p_kind,p_request_id,recipient,trim(p_subject),trim(p_message))
 returning id into claimed;
 return jsonb_build_object('reserved',true,'id',claimed,'recipient',recipient);
end $body$;
revoke all on function public.claim_staff_email_reply(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_staff_email_reply(uuid,uuid,text,uuid,text,text) to service_role;

create or replace function public.finish_staff_email_reply(
 p_reply_id uuid,p_status text,p_provider_id text default null,p_category text default null
) returns boolean language plpgsql security definer
set search_path to pg_catalog,private
as $body$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
   raise exception 'forbidden';
 end if;
 if p_status not in ('accepted','rejected','needs_review') then raise exception 'Invalid status';end if;
 update private.staff_email_replies set status=p_status,
    provider_id=left(coalesce(p_provider_id,''),255),
    failure_category=left(coalesce(p_category,''),100),updated_at=now()
 where id=p_reply_id and status='reserved';
 return found;
end $body$;
revoke all on function public.finish_staff_email_reply(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_staff_email_reply(uuid,text,text,text) to service_role;
