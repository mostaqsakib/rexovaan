ALTER TABLE public.bot_orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bot';
CREATE INDEX IF NOT EXISTS idx_bot_orders_source_created ON public.bot_orders (source, created_at DESC);