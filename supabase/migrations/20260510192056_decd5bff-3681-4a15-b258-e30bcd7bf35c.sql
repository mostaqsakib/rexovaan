CREATE TABLE IF NOT EXISTS public.bot_flash_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  sale_price numeric NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  announcement_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_flash_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access flash sales"
ON public.bot_flash_sales
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_bot_flash_sales_active_product
  ON public.bot_flash_sales (product_id, is_active, ends_at);