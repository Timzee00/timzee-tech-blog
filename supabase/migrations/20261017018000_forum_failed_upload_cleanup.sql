-- Permit users to clean up their own failed forum uploads, and nothing else.
DROP POLICY IF EXISTS auth_delete_own_community_media ON storage.objects;
CREATE POLICY auth_delete_own_community_media ON storage.objects FOR DELETE TO authenticated
USING (
 bucket_id='media'
 AND (storage.foldername(name))[1] IN ('community-threads','community-replies')
 AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
);
