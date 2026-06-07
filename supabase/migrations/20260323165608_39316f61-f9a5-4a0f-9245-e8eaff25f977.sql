CREATE TABLE public.bot_product_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.bot_products(id) ON DELETE CASCADE,
  min_quantity integer NOT NULL DEFAULT 1,
  max_quantity integer,
  price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, min_quantity)
);

ALTER TABLE public.bot_product_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.bot_product_pricing FOR ALL USING (true) WITH CHECK (true);