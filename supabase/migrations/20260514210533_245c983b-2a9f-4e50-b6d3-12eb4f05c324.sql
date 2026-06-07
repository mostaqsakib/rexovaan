ALTER TABLE public.bot_orders
  ADD COLUMN IF NOT EXISTS delivered_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_notes jsonb NOT NULL DEFAULT '{}'::jsonb;