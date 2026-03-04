-- NOVEL_FEATURES_MIGRATION.sql
-- Adds novel comments and keeps novel like/chapter counters in sync.

begin;

create table if not exists public.novel_comments (
  id uuid primary key,
  novel_id uuid not null references public.novels(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body text not null,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index if not exists novel_comments_novel_idx on public.novel_comments(novel_id);
create index if not exists novel_comments_chapter_idx on public.novel_comments(chapter_id);
create index if not exists novel_comments_created_idx on public.novel_comments(created_at desc);

alter table public.novel_comments enable row level security;

drop policy if exists "Novel comments public read" on public.novel_comments;
create policy "Novel comments public read" on public.novel_comments
  for select using (true);

drop policy if exists "Users insert novel comments" on public.novel_comments;
create policy "Users insert novel comments" on public.novel_comments
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own novel comments" on public.novel_comments;
create policy "Users update own novel comments" on public.novel_comments
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own novel comments" on public.novel_comments;
create policy "Users delete own novel comments" on public.novel_comments
  for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.refresh_novel_like_count()
returns trigger
language plpgsql
as $$
declare
  target_novel uuid;
begin
  if tg_op = 'DELETE' then
    target_novel := old.novel_id;
  else
    target_novel := new.novel_id;
  end if;
  if target_novel is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  update public.novels
  set likes = (
      select count(*)::int
      from public.novel_likes
      where novel_id = target_novel
    ),
    updated_at = now()
  where id = target_novel;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refresh_novel_like_count on public.novel_likes;
create trigger trg_refresh_novel_like_count
  after insert or delete on public.novel_likes
  for each row
  execute function public.refresh_novel_like_count();

create or replace function public.refresh_novel_chapter_count()
returns trigger
language plpgsql
as $$
declare
  target_novel uuid;
begin
  if tg_op = 'DELETE' then
    target_novel := old.novel_id;
  else
    target_novel := new.novel_id;
  end if;
  if target_novel is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  update public.novels
  set chapters_count = (
      select count(*)::int
      from public.chapters
      where novel_id = target_novel
    ),
    updated_at = now()
  where id = target_novel;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refresh_novel_chapter_count on public.chapters;
create trigger trg_refresh_novel_chapter_count
  after insert or delete or update of novel_id on public.chapters
  for each row
  execute function public.refresh_novel_chapter_count();

-- Backfill counters once.
update public.novels n
set likes = coalesce(l.like_count, 0),
    chapters_count = coalesce(c.chapter_count, 0),
    updated_at = now()
from (
  select novel_id, count(*)::int as like_count
  from public.novel_likes
  group by novel_id
) l
full outer join (
  select novel_id, count(*)::int as chapter_count
  from public.chapters
  group by novel_id
) c on c.novel_id = l.novel_id
where n.id = coalesce(l.novel_id, c.novel_id);

commit;
