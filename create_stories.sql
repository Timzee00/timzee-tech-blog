-- Stories feature: ephemeral (24h) posts, public or friends-only, like
-- Snapchat/Instagram stories. Run this whole file in the Supabase SQL Editor.

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null default 'image', -- 'image' | 'video'
  caption text,
  visibility text not null default 'public', -- 'public' | 'private' (friends-only)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists stories_user_id_idx on stories(user_id);
create index if not exists stories_expires_at_idx on stories(expires_at);

alter table stories enable row level security;

drop policy if exists "stories_select_visible" on stories;
create policy "stories_select_visible"
on stories for select
to authenticated
using (
  expires_at > now()
  and (
    visibility = 'public'
    or user_id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = stories.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = stories.user_id)
        )
    )
  )
);

drop policy if exists "stories_insert_own" on stories;
create policy "stories_insert_own"
on stories for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "stories_delete_own" on stories;
create policy "stories_delete_own"
on stories for delete
to authenticated
using (auth.uid() = user_id);

-- Storage: stories media goes in the existing `media` bucket under a new
-- `stories/{user_id}/...` folder, matching the pattern already used for
-- avatars/videos. Add an upload policy for it (folder wasn't in the
-- original allowed-list, same class of gap the marketplace folder had).
drop policy if exists "auth_upload_stories" on storage.objects;
create policy "auth_upload_stories"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media'
  and (storage.foldername(name))[1] = 'stories'
);

drop policy if exists "auth_delete_own_stories" on storage.objects;
create policy "auth_delete_own_stories"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media'
  and (storage.foldername(name))[1] = 'stories'
  and (storage.foldername(name))[2] = auth.uid()::text
);
