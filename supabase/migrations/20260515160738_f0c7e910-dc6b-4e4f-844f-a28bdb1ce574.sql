ALTER TABLE public.bot_withdrawals
  ADD COLUMN IF NOT EXISTS network text,
  ADD COLUMN IF NOT EXISTS asset text DEFAULT 'USDT',
  ADD COLUMN IF NOT EXISTS binance_withdraw_id text,
  ADD COLUMN IF NOT EXISTS txn_hash text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS auto_attempted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bot_withdrawals_status ON public.bot_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_bot_withdrawals_customer_created ON public.bot_withdrawals(customer_id, created_at DESC);