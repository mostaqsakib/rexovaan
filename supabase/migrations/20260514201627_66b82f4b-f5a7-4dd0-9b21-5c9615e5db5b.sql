
ALTER TABLE public.bot_products
  ADD COLUMN IF NOT EXISTS customer_input_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.bot_orders
  ADD COLUMN IF NOT EXISTS customer_inputs jsonb,
  ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_bot_orders_status_pending_manual
  ON public.bot_orders (status) WHERE status = 'pending_manual_delivery';
