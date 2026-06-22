CREATE TABLE public.bot_campaign_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  campaign_key text NOT NULL DEFAULT 'referral',
  target_type text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_campaign_messages_campaign ON public.bot_campaign_messages(campaign_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_campaign_messages TO authenticated;
GRANT ALL ON public.bot_campaign_messages TO service_role;
ALTER TABLE public.bot_campaign_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage campaign messages" ON public.bot_campaign_messages FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());