ALTER TABLE public.bot_payment_methods
  ADD COLUMN IF NOT EXISTS enabled_for_purchase boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enabled_for_deposit boolean NOT NULL DEFAULT true;