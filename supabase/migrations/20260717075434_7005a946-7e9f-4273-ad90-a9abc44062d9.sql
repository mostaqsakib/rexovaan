
CREATE TABLE public.bot_link_check_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id BIGINT NOT NULL,
  tg_username TEXT,
  tg_first_name TEXT,
  tg_last_name TEXT,
  chat_id BIGINT,
  label TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_link_check_logs_created_at ON public.bot_link_check_logs (created_at DESC);
CREATE INDEX idx_bot_link_check_logs_tg_user_id ON public.bot_link_check_logs (tg_user_id);

GRANT SELECT ON public.bot_link_check_logs TO authenticated;
GRANT ALL ON public.bot_link_check_logs TO service_role;

ALTER TABLE public.bot_link_check_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read bot link check logs"
ON public.bot_link_check_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
