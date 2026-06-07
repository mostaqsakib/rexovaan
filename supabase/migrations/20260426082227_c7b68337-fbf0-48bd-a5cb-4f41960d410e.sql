ALTER TABLE public.bot_resellers
ADD COLUMN IF NOT EXISTS customer_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS bot_resellers_customer_id_unique
ON public.bot_resellers (customer_id)
WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bot_resellers_customer_id
ON public.bot_resellers (customer_id);