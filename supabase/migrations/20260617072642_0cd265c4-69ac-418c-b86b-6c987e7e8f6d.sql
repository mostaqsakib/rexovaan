
CREATE TABLE IF NOT EXISTS public.user_channel_verification (
  user_id BIGINT PRIMARY KEY,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_channel_verification TO authenticated;
GRANT ALL ON public.user_channel_verification TO service_role;

ALTER TABLE public.user_channel_verification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view channel verification"
  ON public.user_channel_verification FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.bot_settings (key, value) VALUES
  ('channel_join_enabled', 'false'),
  ('channel_join_username', ''),
  ('channel_join_message', E'🔔 <b>Please join our channel to continue using this bot.</b>\n\nAfter joining, tap "Done ✅" below.'),
  ('channel_join_button_emoji', '📢'),
  ('channel_join_done_emoji', '✅')
ON CONFLICT (key) DO NOTHING;
