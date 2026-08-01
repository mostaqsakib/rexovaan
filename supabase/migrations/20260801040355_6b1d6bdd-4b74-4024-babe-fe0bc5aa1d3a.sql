ALTER TABLE public.ton_reserved_deposits
  ADD COLUMN IF NOT EXISTS asset text NOT NULL DEFAULT 'USDT',
  ADD COLUMN IF NOT EXISTS asset_amount numeric NOT NULL DEFAULT 0;