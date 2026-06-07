ALTER TABLE public.bot_deposits ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bot';
CREATE INDEX IF NOT EXISTS idx_bot_deposits_source ON public.bot_deposits(source);
CREATE INDEX IF NOT EXISTS idx_bot_deposits_created_at ON public.bot_deposits(created_at DESC);