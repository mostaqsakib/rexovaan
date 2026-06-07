CREATE TABLE public.bot_product_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'lovable',
  base_url text NOT NULL,
  api_key text NOT NULL,
  auth_header text NOT NULL DEFAULT 'Authorization',
  auth_prefix text NOT NULL DEFAULT 'Bearer ',
  is_active boolean NOT NULL DEFAULT true,
  last_balance numeric,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_product_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.bot_product_sources
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.bot_products
  ADD COLUMN source_id uuid REFERENCES public.bot_product_sources(id) ON DELETE SET NULL,
  ADD COLUMN source_product_id text;

CREATE INDEX idx_bot_products_source ON public.bot_products(source_id) WHERE source_id IS NOT NULL;