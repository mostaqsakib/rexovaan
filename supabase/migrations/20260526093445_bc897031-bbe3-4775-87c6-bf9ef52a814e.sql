DROP POLICY IF EXISTS "Public can read site branding settings" ON public.bot_settings;
CREATE POLICY "Public can read site branding settings"
ON public.bot_settings
FOR SELECT
TO anon, authenticated
USING (key IN ('site_logo_url', 'site_shop_name', 'dollar_rate_bdt'));