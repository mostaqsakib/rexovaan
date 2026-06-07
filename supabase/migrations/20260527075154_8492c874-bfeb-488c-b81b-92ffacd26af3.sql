ALTER TABLE public.site_announcements
  ADD COLUMN IF NOT EXISTS body_html TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT;