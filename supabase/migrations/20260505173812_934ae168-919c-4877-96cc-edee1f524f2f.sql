DELETE FROM public.bot_product_pricing WHERE product_id NOT IN (SELECT id FROM public.bot_products);

ALTER TABLE public.bot_product_pricing
  ADD CONSTRAINT bot_product_pricing_product_fk
  FOREIGN KEY (product_id) REFERENCES public.bot_products(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS bot_products_source_dedup_idx
  ON public.bot_products (source_id, source_product_id)
  WHERE source_id IS NOT NULL AND source_product_id IS NOT NULL;