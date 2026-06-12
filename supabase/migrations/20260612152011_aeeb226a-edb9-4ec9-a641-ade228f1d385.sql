
ALTER TABLE public.bot_products
  ADD COLUMN IF NOT EXISTS link_check_auto boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bot_products_link_check_auto
  ON public.bot_products(link_check_auto) WHERE link_check_auto = true;
