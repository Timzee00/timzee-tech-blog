-- A permanently removed post must not leave comments pointing to it.
-- No existing posts/comments are deleted by applying this migration.
-- The operation is destructive only when an authorized user subsequently
-- chooses "Delete permanently" for a particular post.
alter table public.comments
  drop constraint if exists comments_post_id_fkey;
alter table public.comments
  add constraint comments_post_id_fkey
  foreign key (post_id) references public.posts(id)
  on delete cascade;
