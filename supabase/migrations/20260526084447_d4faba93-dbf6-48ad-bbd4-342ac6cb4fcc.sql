
DROP POLICY IF EXISTS "Service role full access balance adjustments" ON public.bot_balance_adjustments;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_customers;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_deposits;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_orders;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_product_sources;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_product_stock_items;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_referral_earnings;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_referrals;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_settings;
DROP POLICY IF EXISTS "Service role full access" ON public.bot_withdrawals;
DROP POLICY IF EXISTS "Allow all access to notification settings" ON public.bot_notification_settings;

-- Storage: instruction-media — restrict writes to authenticated users
DROP POLICY IF EXISTS "Allow uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes" ON storage.objects;
CREATE POLICY "Authenticated can upload instruction-media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'instruction-media');
CREATE POLICY "Authenticated can delete instruction-media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'instruction-media');

-- Storage: site-assets — restrict writes to authenticated users
DROP POLICY IF EXISTS "Anyone can upload site-assets" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update site-assets" ON storage.objects;
CREATE POLICY "Authenticated can upload site-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-assets');
CREATE POLICY "Authenticated can update site-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'site-assets')
  WITH CHECK (bucket_id = 'site-assets');
