
CREATE TABLE public.bot_broadcast_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_chat_id BIGINT,
  text TEXT NOT NULL,
  reply_markup JSONB,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failed_chat_ids BIGINT[] NOT NULL DEFAULT '{}',
  last_resent_at TIMESTAMPTZ,
  resend_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.bot_broadcast_history TO service_role;
GRANT SELECT ON public.bot_broadcast_history TO authenticated;

ALTER TABLE public.bot_broadcast_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view broadcast history"
ON public.bot_broadcast_history FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_bot_broadcast_history_created_at ON public.bot_broadcast_history (created_at DESC);
