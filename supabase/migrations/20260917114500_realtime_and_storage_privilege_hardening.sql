-- Enable the tables used by the browser's Postgres Changes subscriptions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
END $$;

-- Storage admin access must use trusted database role state only.
DROP POLICY IF EXISTS "admin_upload_admin_media" ON storage.objects;
DROP POLICY IF EXISTS "admin_upload_covers" ON storage.objects;

CREATE POLICY "admin_upload_admin_media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = ANY (ARRAY['covers','post-media','ads','themes','videos'])
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND lower(coalesce(p.role, '')) IN ('admin','super')
    )
  );
