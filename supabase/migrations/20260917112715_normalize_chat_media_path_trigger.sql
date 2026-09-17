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
  else
    new.media_path := null;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_direct_message_media_path() from public;
