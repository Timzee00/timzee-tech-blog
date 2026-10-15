-- Explicit human audit trail for uncertain Brevo sends. Never queues or resends mail.
create table if not exists private.email_review_actions (
  id bigint generated always as identity primary key,
  job_id uuid not null references private.email_jobs(id) on delete restrict,
  actor_id uuid not null,
  decision text not null check (decision in (
    'needs_investigation','provider_delivery_confirmed','provider_not_sent_confirmed','closed_no_retry'
  )),
  note text not null check (length(trim(note)) between 15 and 1000),
  reviewed_at timestamptz not null default now()
);
create index if not exists email_review_actions_job_history
  on private.email_review_actions(job_id,reviewed_at desc,id desc);
alter table private.email_review_actions enable row level security;
revoke all on private.email_review_actions from public,anon,authenticated;
grant select,insert on private.email_review_actions to service_role;
grant usage,select on sequence private.email_review_actions_id_seq to service_role;

create or replace function public.list_email_review_cases(p_limit integer default 25)
returns jsonb language plpgsql stable security definer
set search_path to pg_catalog,private
as $body$
declare result jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at asc), '[]'::jsonb)
  into result from (
    select j.id,j.template,j.attempts,j.created_at,j.updated_at,
           j.delivery_state,
           left(coalesce(j.last_error,''),220) as reason,
           coalesce(review.decision,'unreviewed') as last_decision,
           review.reviewed_at
    from private.email_jobs j
    left join lateral (
      select decision,reviewed_at
      from private.email_review_actions a
      where a.job_id=j.id
      order by a.id desc limit 1
    ) review on true
    where j.status='failed'
      and j.last_error like 'Manual reconciliation required:%'
      and (review.decision is null or review.decision='needs_investigation')
    order by j.created_at asc
    limit least(greatest(coalesce(p_limit,25),1),50)
  ) t;
  return result;
end $body$;
revoke all on function public.list_email_review_cases(integer) from public,anon,authenticated;
grant execute on function public.list_email_review_cases(integer) to service_role;

create or replace function public.record_email_review_action(
  p_job_id uuid,p_actor_id uuid,p_decision text,p_note text
) returns jsonb language plpgsql security definer
set search_path to pg_catalog,private
as $body$
declare
 current_review text;
 is_quarantined boolean;
 review_id bigint;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_actor_id is null or p_decision not in (
    'needs_investigation','provider_delivery_confirmed','provider_not_sent_confirmed','closed_no_retry'
  ) or length(trim(coalesce(p_note,''))) not between 15 and 1000 then
    raise exception 'Invalid review decision or note';
  end if;
  select j.status='failed' and j.last_error like 'Manual reconciliation required:%'
  into is_quarantined
  from private.email_jobs j where j.id=p_job_id for update;
  if not found or is_quarantined is distinct from true then
    raise exception 'Job is not awaiting manual reconciliation';
  end if;
  select decision into current_review
  from private.email_review_actions where job_id=p_job_id order by id desc limit 1;
  if current_review is not null and current_review <> 'needs_investigation' then
    raise exception 'Case is already closed';
  end if;
  insert into private.email_review_actions(job_id,actor_id,decision,note)
  values(p_job_id,p_actor_id,p_decision,trim(p_note)) returning id into review_id;
  return jsonb_build_object('review_id',review_id,'decision',p_decision,'sent',false);
end $body$;
revoke all on function public.record_email_review_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_email_review_action(uuid,uuid,text,text) to service_role;
