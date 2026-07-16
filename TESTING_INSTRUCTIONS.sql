-- TESTING_INSTRUCTIONS.sql
-- Run these in Supabase SQL editor (after running GUARDED_MIGRATIONS_AND_RLS_FIXES.sql)

-- 1) Verify add_chat_members exists
SELECT proname FROM pg_proc WHERE proname = 'add_chat_members';

-- 2) Create a test group and call the RPC (replace 'YOUR_USER_ID' if needed)
WITH t AS (
  INSERT INTO public.chat_threads (id, name, is_group, created_by, created_at)
  VALUES (gen_random_uuid(), 'Test Group (SQL)', true, '90294c89-c92d-4ee9-b344-c76023966b2c'::uuid, now())
  RETURNING id
),
_rpc AS (
  SELECT public.add_chat_members(
    (SELECT id FROM t),
    ARRAY[ jsonb_build_object('user_id','90294c89-c92d-4ee9-b344-c76023966b2c')::jsonb ]
  )
)
SELECT cm.* FROM public.chat_members cm WHERE cm.thread_id = (SELECT id FROM t);

-- 3) Verify mentions columns exist
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='comments' AND column_name='mentions';
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='direct_messages' AND column_name='mentions';

-- 4) Insert a direct message with mentions
INSERT INTO public.direct_messages (id, thread_id, sender_id, body, mentions, created_at)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM public.chat_threads WHERE created_by = '90294c89-c92d-4ee9-b344-c76023966b2c' ORDER BY created_at DESC LIMIT 1),
  '90294c89-c92d-4ee9-b344-c76023966b2c'::uuid,
  'Test mention from SQL',
  ARRAY['90294c89-c92d-4ee9-b344-c76023966b2c'::uuid],
  now()
)
RETURNING *;

-- 5) Cleanup (delete the test group and messages)
-- DELETE FROM public.direct_messages WHERE thread_id = '<THREAD_ID>'::uuid AND body = 'Test mention from SQL';
-- DELETE FROM public.chat_members WHERE thread_id = '<THREAD_ID>'::uuid;
-- DELETE FROM public.chat_threads WHERE id = '<THREAD_ID>'::uuid;