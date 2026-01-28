-- Timzee Tech Hub - Extended Schema for Marketplace, Videos, Verification, and AI
-- Run these SQL statements in Supabase after the main SUPABASE_SCHEMA.sql

-- ============================================================================
-- VIDEOS / TIKTOK-STYLE SECTION
-- ============================================================================

create table if not exists public.videos (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  author_name text,
  title text,
  description text,
  video_url text,
  thumbnail_url text,
  duration int,
  tags text[],
  category text,
  is_public boolean default true,
  view_count int default 0,
  like_count int default 0,
  comment_count int default 0,
  created_at timestamp default now(),
  updated_at timestamp
);

create table if not exists public.video_likes (
  id uuid primary key,
  video_id uuid references public.videos(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamp default now(),
  unique (video_id, user_id)
);

create table if not exists public.video_comments (
  id uuid primary key,
  video_id uuid references public.videos(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  author_name text,
  body text,
  reply_to uuid references public.video_comments(id) on delete cascade,
  created_at timestamp default now(),
  updated_at timestamp
);

create index if not exists videos_user_id_idx on public.videos(user_id);
create index if not exists videos_category_idx on public.videos(category);
create index if not exists videos_created_at_idx on public.videos(created_at desc);
create index if not exists video_likes_video_idx on public.video_likes(video_id);
create index if not exists video_comments_video_idx on public.video_comments(video_id);

alter table public.videos enable row level security;
alter table public.video_likes enable row level security;
alter table public.video_comments enable row level security;

drop policy if exists "Videos public read" on public.videos;
create policy "Videos public read" on public.videos
  for select using (is_public = true);
drop policy if exists "Videos owner read all" on public.videos;
create policy "Videos owner read all" on public.videos
  for select using (auth.uid() = user_id);
drop policy if exists "Users create videos" on public.videos;
create policy "Users create videos" on public.videos
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own videos" on public.videos;
create policy "Users update own videos" on public.videos
  for update using (auth.uid() = user_id);
drop policy if exists "Users delete own videos" on public.videos;
create policy "Users delete own videos" on public.videos
  for delete using (auth.uid() = user_id);

drop policy if exists "Video likes public" on public.video_likes;
create policy "Video likes public" on public.video_likes
  for select using (true);
drop policy if exists "Users like videos" on public.video_likes;
create policy "Users like videos" on public.video_likes
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users unlike videos" on public.video_likes;
create policy "Users unlike videos" on public.video_likes
  for delete using (auth.uid() = user_id);

drop policy if exists "Video comments public" on public.video_comments;
create policy "Video comments public" on public.video_comments
  for select using (true);
drop policy if exists "Users comment videos" on public.video_comments;
create policy "Users comment videos" on public.video_comments
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own video comments" on public.video_comments;
create policy "Users update own video comments" on public.video_comments
  for update using (auth.uid() = user_id);

-- ============================================================================
-- MARKETPLACE / FACEBOOK-STYLE CLASSIFIEDS
-- ============================================================================

create table if not exists public.marketplace_items (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  seller_name text,
  title text,
  description text,
  category text,
  subcategory text,
  price numeric(12, 2),
  currency text default 'USD',
  condition text,
  location text,
  images text[],
  is_available boolean default true,
  view_count int default 0,
  created_at timestamp default now(),
  updated_at timestamp,
  expires_at timestamp
);

create table if not exists public.marketplace_inquiries (
  id uuid primary key,
  item_id uuid references public.marketplace_items(id) on delete cascade,
  buyer_id uuid references auth.users(id) on delete cascade,
  buyer_name text,
  message text,
  status text default 'pending',
  created_at timestamp default now(),
  updated_at timestamp
);

create table if not exists public.marketplace_transactions (
  id uuid primary key,
  item_id uuid references public.marketplace_items(id) on delete cascade,
  seller_id uuid references auth.users(id) on delete set null,
  buyer_id uuid references auth.users(id) on delete set null,
  amount numeric(12, 2),
  status text default 'pending',
  created_at timestamp default now(),
  updated_at timestamp
);

create table if not exists public.marketplace_reviews (
  id uuid primary key,
  transaction_id uuid references public.marketplace_transactions(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete cascade,
  reviewee_id uuid references auth.users(id) on delete cascade,
  rating int,
  comment text,
  created_at timestamp default now()
);

create index if not exists marketplace_items_user_idx on public.marketplace_items(user_id);
create index if not exists marketplace_items_category_idx on public.marketplace_items(category);
create index if not exists marketplace_items_available_idx on public.marketplace_items(is_available);
create index if not exists marketplace_inquiries_item_idx on public.marketplace_inquiries(item_id);
create index if not exists marketplace_inquiries_buyer_idx on public.marketplace_inquiries(buyer_id);

alter table public.marketplace_items enable row level security;
alter table public.marketplace_inquiries enable row level security;
alter table public.marketplace_transactions enable row level security;
alter table public.marketplace_reviews enable row level security;

drop policy if exists "Marketplace items public" on public.marketplace_items;
create policy "Marketplace items public" on public.marketplace_items
  for select using (is_available = true);
drop policy if exists "Sellers view own items" on public.marketplace_items;
create policy "Sellers view own items" on public.marketplace_items
  for select using (auth.uid() = user_id);
drop policy if exists "Users create items" on public.marketplace_items;
create policy "Users create items" on public.marketplace_items
  for insert with check (auth.uid() = user_id);
drop policy if exists "Sellers update own items" on public.marketplace_items;
create policy "Sellers update own items" on public.marketplace_items
  for update using (auth.uid() = user_id);
drop policy if exists "Sellers delete own items" on public.marketplace_items;
create policy "Sellers delete own items" on public.marketplace_items
  for delete using (auth.uid() = user_id);

drop policy if exists "Inquiries auth read" on public.marketplace_inquiries;
create policy "Inquiries auth read" on public.marketplace_inquiries
  for select using (auth.uid() = buyer_id or auth.uid() = (select user_id from public.marketplace_items where id = item_id));
drop policy if exists "Users create inquiries" on public.marketplace_inquiries;
create policy "Users create inquiries" on public.marketplace_inquiries
  for insert with check (auth.uid() = buyer_id);

-- ============================================================================
-- VERIFICATION LEVELS & BADGES
-- ============================================================================

create table if not exists public.verification_badges (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  verification_level text,
  verified_by uuid,
  verified_at timestamp,
  expires_at timestamp,
  reason text,
  created_at timestamp default now()
);

create table if not exists public.verification_applications (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  user_email text,
  user_name text,
  verification_type text,
  documents jsonb,
  message text,
  status text default 'pending',
  reviewed_by uuid,
  reviewed_at timestamp,
  created_at timestamp default now()
);

-- Verification levels: none, silver, gold, platinum, blue_check, business
-- Add new columns to profiles for verification customization
alter table if exists public.profiles
  add column if not exists verification_level text default 'none',
  add column if not exists verification_color text,
  add column if not exists profile_design text default 'standard',
  add column if not exists is_private boolean default false,
  add column if not exists bio_html text,
  add column if not exists followers_count int default 0,
  add column if not exists following_count int default 0;

create index if not exists verification_badges_user_idx on public.verification_badges(user_id);
create index if not exists verification_applications_status_idx on public.verification_applications(status);

alter table public.verification_badges enable row level security;
alter table public.verification_applications enable row level security;

drop policy if exists "Badges public read" on public.verification_badges;
create policy "Badges public read" on public.verification_badges
  for select using (true);
drop policy if exists "Users apply for verification" on public.verification_applications;
create policy "Users apply for verification" on public.verification_applications
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users read own applications" on public.verification_applications;
create policy "Users read own applications" on public.verification_applications
  for select using (auth.uid() = user_id);
drop policy if exists "Admins manage applications" on public.verification_applications;
create policy "Admins manage applications" on public.verification_applications
  for all using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- ============================================================================
-- MENTIONS & REPLIES
-- ============================================================================

-- Update comments and direct_messages to support mentions and replies
alter table if exists public.comments
  add column if not exists reply_to uuid references public.comments(id) on delete set null,
  add column if not exists mentions uuid[],
  add column if not exists is_edited boolean default false,
  add column if not exists edited_at timestamp;

alter table if exists public.direct_messages
  add column if not exists reply_to uuid references public.direct_messages(id) on delete set null,
  add column if not exists mentions uuid[],
  add column if not exists is_edited boolean default false,
  add column if not exists edited_at timestamp;

create index if not exists comments_reply_to_idx on public.comments(reply_to);
create index if not exists direct_messages_reply_to_idx on public.direct_messages(reply_to);

-- ============================================================================
-- ENHANCED NOTIFICATIONS
-- ============================================================================

-- Update notifications table for more notification types
alter table if exists public.notifications
  add column if not exists notification_type text default 'generic';

create index if not exists notifications_created_at_idx on public.notifications(created_at desc);
create index if not exists notifications_read_at_idx on public.notifications(read_at);

-- ============================================================================
-- REALTIME PRESENCE & ACTIVITY
-- ============================================================================

create table if not exists public.user_activity (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  activity_type text,
  activity_data jsonb,
  created_at timestamp default now()
);

create index if not exists user_activity_user_idx on public.user_activity(user_id);
create index if not exists user_activity_created_at_idx on public.user_activity(created_at desc);

alter table public.user_activity enable row level security;
drop policy if exists "Users read activity" on public.user_activity;
create policy "Users read activity" on public.user_activity
  for select using (true);
drop policy if exists "Users create activity" on public.user_activity;
create policy "Users create activity" on public.user_activity
  for insert with check (auth.uid() = user_id);

-- ============================================================================
-- AI PROMPTS & HISTORY
-- ============================================================================

create table if not exists public.ai_prompts (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  title text,
  system_prompt text,
  description text,
  category text,
  is_public boolean default false,
  version int default 1,
  created_at timestamp default now(),
  updated_at timestamp
);

create table if not exists public.ai_conversations (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  title text,
  model text default 'groq',
  created_at timestamp default now(),
  updated_at timestamp,
  deleted_at timestamp
);

create table if not exists public.ai_messages (
  id uuid primary key,
  conversation_id uuid references public.ai_conversations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text,
  content text,
  tokens_used int default 0,
  created_at timestamp default now()
);

create index if not exists ai_prompts_user_idx on public.ai_prompts(user_id);
create index if not exists ai_conversations_user_idx on public.ai_conversations(user_id);
create index if not exists ai_messages_conversation_idx on public.ai_messages(conversation_id);

alter table public.ai_prompts enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists "Public prompts" on public.ai_prompts;
create policy "Public prompts" on public.ai_prompts
  for select using (is_public = true);
drop policy if exists "Users read own prompts" on public.ai_prompts;
create policy "Users read own prompts" on public.ai_prompts
  for select using (auth.uid() = user_id);
drop policy if exists "Users manage own prompts" on public.ai_prompts;
create policy "Users manage own prompts" on public.ai_prompts
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users conversations" on public.ai_conversations;
create policy "Users conversations" on public.ai_conversations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Conversation messages" on public.ai_messages;
create policy "Conversation messages" on public.ai_messages
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- PAGINATION SUPPORT
-- ============================================================================

-- Add full-text search to more tables
alter table if exists public.videos
  add column if not exists search_vector tsvector;

create index if not exists videos_search_idx on public.videos using gin (search_vector);

create or replace function public.videos_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  return NEW;
end;
$$;

drop trigger if exists videos_search_vector_trigger on public.videos;
create trigger videos_search_vector_trigger
  before insert or update on public.videos
  for each row execute function public.videos_search_vector_update();

alter table if exists public.marketplace_items
  add column if not exists search_vector tsvector;

create index if not exists marketplace_search_idx on public.marketplace_items using gin (search_vector);

create or replace function public.marketplace_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'C');
  return NEW;
end;
$$;

drop trigger if exists marketplace_search_vector_trigger on public.marketplace_items;
create trigger marketplace_search_vector_trigger
  before insert or update on public.marketplace_items
  for each row execute function public.marketplace_search_vector_update();

-- ============================================================================
-- ENABLE REALTIME ON NEW TABLES
-- ============================================================================

alter publication supabase_realtime add table public.videos;
alter publication supabase_realtime add table public.video_comments;
alter publication supabase_realtime add table public.video_likes;
alter publication supabase_realtime add table public.marketplace_items;
alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.ai_messages;
