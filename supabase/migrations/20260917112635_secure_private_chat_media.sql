insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do update
set public = false;

alter table public.direct_messages
  add column if not exists media_path text;

create or replace function public.sync_direct_message_media_path()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  marker text := '/object/sign/chat-media/';
  public_marker text := '/object/public/chat-media/';
  extracted text;
begin
  if new.media_url is null or btrim(new.media_url) = '' then
    new.media_path := null;
    return new;
  end if;

  if position(marker in new.media_url) > 0 then
    extracted := split_part(split_part(new.media_url, marker, 2), '?', 1);
    new.media_path := nullif(extracted, '');
  elsif position(public_marker in new.media_url) > 0 then
    extracted := split_part(split_part(new.media_url, public_marker, 2), '?', 1);
    new.media_path := nullif(extracted, '');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_direct_message_media_path on public.direct_messages;
create trigger trg_sync_direct_message_media_path
before insert or update of media_url on public.direct_messages
for each row execute function public.sync_direct_message_media_path();

create index if not exists direct_messages_media_path_idx
  on public.direct_messages (media_path)
  where media_path is not null;

revoke all on function public.sync_direct_message_media_path() from public;

drop policy if exists "auth_upload_own_chat_media" on storage.objects;
create policy "auth_upload_own_chat_media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = 'direct-messages'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
