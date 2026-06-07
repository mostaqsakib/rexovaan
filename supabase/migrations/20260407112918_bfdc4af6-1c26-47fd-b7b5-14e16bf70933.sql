
-- Add web_price to bot_products
ALTER TABLE public.bot_products ADD COLUMN web_price numeric NOT NULL DEFAULT 0;

-- Add is_web flag to bot_payment_methods
ALTER TABLE public.bot_payment_methods ADD COLUMN is_web boolean NOT NULL DEFAULT false;

-- Create web_customers table
CREATE TABLE public.web_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.web_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read nothing by default" ON public.web_customers
  FOR SELECT USING (false);

CREATE POLICY "Service role full access on web_customers" ON public.web_customers
  FOR ALL USING (true) WITH CHECK (true);

-- Create web_orders table
CREATE TABLE public.web_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.web_customers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.bot_products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  total_price numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment',
  txn_hash text,
  payment_method_id uuid REFERENCES public.bot_payment_methods(id),
  details jsonb,
  row_numbers integer[],
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

ALTER TABLE public.web_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on web_orders" ON public.web_orders
  FOR ALL USING (true) WITH CHECK (true);
