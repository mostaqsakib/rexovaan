
ALTER TABLE public.bot_customers
  ADD COLUMN IF NOT EXISTS pending_inputs jsonb;
