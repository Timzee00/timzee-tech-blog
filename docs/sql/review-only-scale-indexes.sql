-- REVIEW ONLY. DO NOT APPLY ON PRODUCTION WITHOUT STAGING QUERY PLANS.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Apply one at a time outside a transaction, monitor CPU, IO, lock waits,
-- storage and write amplification, then compare EXPLAIN (ANALYZE, BUFFERS).

create index concurrently if not exists idx_posts_created_at_id_desc
  on public.posts (created_at desc, id desc);

create index concurrently if not exists idx_video_comments_video_created_id_desc
  on public.video_comments (video_id, created_at desc, id desc);

create index concurrently if not exists idx_discussion_messages_topic_created_desc
  on public.discussion_messages (topic_id, created_at desc, id desc);

create index concurrently if not exists idx_comments_approved_post
  on public.comments (post_id) where status = 'approved';

-- Existing production indexes already include:
--   idx_direct_messages_thread_created (thread_id, created_at desc)
--   post_likes_post_id_user_id_key (post_id, user_id)
--   comments_post_id_idx (post_id)
--   notifications_user_read_created_idx
-- First test against representative synthetic data, compare plans, and
-- remove redundant proposed indexes where the optimizer sees no benefit.
