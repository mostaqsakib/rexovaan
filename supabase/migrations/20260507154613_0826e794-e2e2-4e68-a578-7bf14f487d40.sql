ALTER TABLE public.bot_customers
  ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ban_reason text,
  ADD COLUMN IF NOT EXISTS banned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bot_customers_is_banned ON public.bot_customers(is_banned) WHERE is_banned = true;