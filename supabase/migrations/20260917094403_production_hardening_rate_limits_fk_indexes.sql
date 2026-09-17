create schema if not exists private;

create table if not exists public.ai_usage_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  window_requests integer not null default 0 check (window_requests >= 0),
  daily_started_at date not null default current_date,
  daily_requests integer not null default 0 check (daily_requests >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ai_usage_limits enable row level security;
revoke all on table public.ai_usage_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_usage_limits to service_role;

create or replace function public.consume_ai_rate_limit(
  p_user_id uuid,
  p_now timestamptz default now(),
  p_request_limit integer default 20,
  p_window_seconds integer default 600,
  p_daily_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.ai_usage_limits%rowtype;
  v_window_reset timestamptz;
  v_daily_reset timestamptz;
  v_retry_after integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_request_limit < 1 or p_window_seconds < 1 or p_daily_limit < 1 then
    raise exception 'invalid rate limit configuration';
  end if;

  insert into public.ai_usage_limits (
    user_id, window_started_at, window_requests, daily_started_at, daily_requests, updated_at
  ) values (
    p_user_id, p_now, 1, p_now::date, 1, p_now
  )
  on conflict (user_id) do nothing;

  select * into v_row
  from public.ai_usage_limits
  where user_id = p_user_id
  for update;

  if v_row.daily_started_at <> p_now::date then
    v_row.daily_started_at := p_now::date;
    v_row.daily_requests := 0;
  end if;

  if v_row.window_started_at + make_interval(secs => p_window_seconds) <= p_now then
    v_row.window_started_at := p_now;
    v_row.window_requests := 0;
  end if;

  if v_row.daily_requests >= p_daily_limit then
    v_daily_reset := (p_now::date + 1)::timestamp at time zone 'UTC';
    v_retry_after := greatest(1, ceil(extract(epoch from (v_daily_reset - p_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'retry_after', v_retry_after,
      'remaining_window', greatest(0, p_request_limit - v_row.window_requests),
      'remaining_daily', 0
    );
  end if;

  if v_row.window_requests >= p_request_limit then
    v_window_reset := v_row.window_started_at + make_interval(secs => p_window_seconds);
    v_retry_after := greatest(1, ceil(extract(epoch from (v_window_reset - p_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limit',
      'retry_after', v_retry_after,
      'remaining_window', 0,
      'remaining_daily', greatest(0, p_daily_limit - v_row.daily_requests)
    );
  end if;

  v_row.window_requests := v_row.window_requests + 1;
  v_row.daily_requests := v_row.daily_requests + 1;
  v_row.updated_at := p_now;

  update public.ai_usage_limits
  set window_started_at = v_row.window_started_at,
      window_requests = v_row.window_requests,
      daily_started_at = v_row.daily_started_at,
      daily_requests = v_row.daily_requests,
      updated_at = v_row.updated_at
  where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'remaining_window', greatest(0, p_request_limit - v_row.window_requests),
    'remaining_daily', greatest(0, p_daily_limit - v_row.daily_requests)
  );
end;
$$;

revoke all on function public.consume_ai_rate_limit(uuid, timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_rate_limit(uuid, timestamptz, integer, integer, integer) to service_role;

create table if not exists public.moderation_audit (
  id bigint generated always as identity primary key,
  moderator_id uuid not null references auth.users(id) on delete restrict,
  moderator_role text not null,
  action text not null,
  content_type text not null,
  content_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.moderation_audit enable row level security;
revoke all on table public.moderation_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.moderation_audit to service_role;
create index if not exists moderation_audit_moderator_id_idx on public.moderation_audit (moderator_id);
create index if not exists moderation_audit_content_idx on public.moderation_audit (content_type, content_id);
create index if not exists moderation_audit_created_at_idx on public.moderation_audit (created_at desc);

create index if not exists admin_requests_user_id_idx on public.admin_requests (user_id);
create index if not exists ai_conversations_user_id_idx on public.ai_conversations (user_id);
create index if not exists ai_messages_conversation_id_idx on public.ai_messages (conversation_id);
create index if not exists ai_messages_user_id_idx on public.ai_messages (user_id);
create index if not exists ai_prompts_user_id_idx on public.ai_prompts (user_id);
create index if not exists announcements_created_by_idx on public.announcements (created_by);
create index if not exists authors_promoted_by_idx on public.authors (promoted_by);
create index if not exists bookmarks_user_id_idx on public.bookmarks (user_id);
create index if not exists content_reports_reporter_id_idx on public.content_reports (reporter_id);
create index if not exists content_requests_user_id_idx on public.content_requests (user_id);
create index if not exists curator_posts_post_id_idx on public.curator_posts (post_id);
create index if not exists curator_sources_category_id_idx on public.curator_sources (category_id);
create index if not exists curator_sources_created_by_idx on public.curator_sources (created_by);
create index if not exists discussion_bans_user_id_idx on public.discussion_bans (user_id);
create index if not exists discussion_message_votes_user_id_idx on public.discussion_message_votes (user_id);
create index if not exists discussion_messages_reply_to_idx on public.discussion_messages (reply_to);
create index if not exists discussion_topics_theme_id_idx on public.discussion_topics (theme_id);
create index if not exists discussion_topics_topic_type_id_idx on public.discussion_topics (topic_type_id);
create index if not exists faqs_created_by_idx on public.faqs (created_by);
create index if not exists moderators_promoted_by_idx on public.moderators (promoted_by);
create index if not exists novel_comments_user_id_idx on public.novel_comments (user_id);
create index if not exists site_settings_theme_id_idx on public.site_settings (theme_id);
create index if not exists site_settings_kv_theme_id_idx on public.site_settings_kv (theme_id);
create index if not exists topic_references_created_by_idx on public.topic_references (created_by);
create index if not exists user_roles_granted_by_idx on public.user_roles (granted_by);
