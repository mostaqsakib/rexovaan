CREATE POLICY "Admin manage product-files objects"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'product-files' AND public.is_admin())
WITH CHECK (bucket_id = 'product-files' AND public.is_admin());