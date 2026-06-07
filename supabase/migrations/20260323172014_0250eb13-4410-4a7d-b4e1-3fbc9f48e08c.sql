-- Add delivery_media column to store media URLs
ALTER TABLE public.bot_products ADD COLUMN delivery_media jsonb DEFAULT '[]'::jsonb;

-- Create storage bucket for instruction media
INSERT INTO storage.buckets (id, name, public) VALUES ('instruction-media', 'instruction-media', true);

-- Allow public read access
CREATE POLICY "Public read access" ON storage.objects FOR SELECT USING (bucket_id = 'instruction-media');

-- Allow anon/authenticated uploads
CREATE POLICY "Allow uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'instruction-media');

-- Allow deletes
CREATE POLICY "Allow deletes" ON storage.objects FOR DELETE USING (bucket_id = 'instruction-media');