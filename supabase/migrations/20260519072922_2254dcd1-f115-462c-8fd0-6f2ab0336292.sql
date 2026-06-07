CREATE TABLE public.bot_customer_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);

ALTER TABLE public.bot_customer_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access customer pricing"
ON public.bot_customer_pricing
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_bot_customer_pricing_customer ON public.bot_customer_pricing(customer_id);
CREATE INDEX idx_bot_customer_pricing_product ON public.bot_customer_pricing(product_id);