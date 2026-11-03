create or replace function public.get_direct_message_previews(p_thread_ids text[])
returns table(
  id uuid,
  thread_id text,
  body text,
  media_type text,
  created_at timestamp without time zone,
  sender_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select recent.id, recent.thread_id, recent.body, recent.media_type,
         recent.created_at, recent.sender_id
  from (
    select distinct requested.thread_id
    from unnest(p_thread_ids) as requested(thread_id)
    where requested.thread_id is not null
      and length(requested.thread_id) between 1 and 180
    limit 64
  ) as requested
  cross join lateral (
    select message.id, message.thread_id, message.body,
           message.media_type, message.created_at, message.sender_id
    from public.direct_messages as message
    where message.thread_id = requested.thread_id
    order by message.created_at desc, message.id desc
    limit 1
  ) as recent;
$$;
revoke all on function public.get_direct_message_previews(text[]) from public;
revoke all on function public.get_direct_message_previews(text[]) from anon;
grant execute on function public.get_direct_message_previews(text[]) to authenticated;
-- Supabase's default ACL grants anon directly; remove it explicitly.
