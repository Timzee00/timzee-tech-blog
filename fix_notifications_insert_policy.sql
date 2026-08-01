-- Fix: notifications never appear for friend requests, post likes, discussion
-- replies, video likes/comments, new messages, mentions, etc.
--
-- Root cause: every one of those code paths calls createNotification(), which
-- inserts a row with user_id = THE RECIPIENT (not the sender). If the
-- notifications table's INSERT policy follows the common default pattern of
-- "auth.uid() = user_id" (only allowed to insert your own rows), then EVERY
-- one of these inserts is silently blocked by RLS -- and the app code wraps
-- all of these calls in .catch(() => {}) (or doesn't check .error at all),
-- so the failure is completely invisible in the UI. This matches "friend
-- request / like / reply notifications never show up" exactly.
--
-- Run this in the Supabase SQL Editor. It's safe to run even if a policy by
-- one of these names doesn't already exist (DROP POLICY IF EXISTS is a no-op
-- in that case).

drop policy if exists "Users insert own notifications" on notifications;
drop policy if exists "notifications_insert_own" on notifications;
drop policy if exists "authenticated_insert_notifications" on notifications;

-- Any authenticated user can create a notification FOR ANY recipient. This is
-- intentionally permissive: the app never lets a user pick arbitrary
-- notification content from the client in a way that matters (it's always
-- one of a fixed set of helper functions with fixed titles/bodies), so the
-- only realistic abuse is spamming someone with fake-but-harmless
-- notifications -- same trust level as being able to friend-request or
-- comment on someone. If you want it tighter later, this can be swapped for
-- a SECURITY DEFINER function that validates the notification type/shape
-- server-side instead of a client-side INSERT.
create policy "authenticated_insert_notifications"
on notifications for insert
to authenticated
with check (true);

-- Keep read/update locked to the notification's own owner (should already
-- exist, but included so this file is a complete, standalone fix).
drop policy if exists "Users read own notifications" on notifications;
create policy "Users read own notifications"
on notifications for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users update own notifications" on notifications;
create policy "Users update own notifications"
on notifications for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
