
-- Fix 1: user_channel_verification — restrict SELECT to admins only (was USING true)
DROP POLICY IF EXISTS "Admins can view channel verification" ON public.user_channel_verification;
CREATE POLICY "Admins can view channel verification"
  ON public.user_channel_verification
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Fix 2: profile-uploads storage bucket — add owner-scoped policies as secure baseline.
-- Folder convention: files stored under <auth.uid()>/...
DROP POLICY IF EXISTS "profile_uploads_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "profile_uploads_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "profile_uploads_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "profile_uploads_owner_delete" ON storage.objects;

CREATE POLICY "profile_uploads_owner_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'profile-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "profile_uploads_owner_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "profile_uploads_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'profile-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "profile_uploads_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
