
CREATE TABLE public.bot_custom_emoji_cache (
  emoji_id text PRIMARY KEY,
  lottie_url text,
  fallback text,
  status text NOT NULL DEFAULT 'ready',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_custom_emoji_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read custom emoji cache"
  ON public.bot_custom_emoji_cache FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role full access custom emoji cache"
  ON public.bot_custom_emoji_cache FOR ALL
  USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('custom-emojis', 'custom-emojis', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read custom emojis"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'custom-emojis');

CREATE POLICY "Service role write custom emojis"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'custom-emojis');
