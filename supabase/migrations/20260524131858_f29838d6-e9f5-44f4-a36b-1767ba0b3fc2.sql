INSERT INTO storage.buckets (id, name, public) VALUES ('site-assets', 'site-assets', true) ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Public read site-assets" ON storage.objects FOR SELECT USING (bucket_id = 'site-assets');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can upload site-assets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'site-assets');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can update site-assets" ON storage.objects FOR UPDATE USING (bucket_id = 'site-assets');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.bot_settings (key, value) VALUES ('site_logo_url', ''), ('site_shop_name', 'Rexovaan Shop') ON CONFLICT (key) DO NOTHING;