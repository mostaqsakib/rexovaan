
-- Bot customers table
CREATE TABLE public.bot_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bot products (price info for telegram bot)
CREATE TABLE public.bot_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sheet_tab TEXT NOT NULL,
  detail_columns TEXT[] NOT NULL DEFAULT '{}',
  sold_column TEXT NOT NULL DEFAULT 'Sold/Unsold',
  sold_value TEXT NOT NULL DEFAULT 'SOLD',
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USDT',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bot deposits
CREATE TABLE public.bot_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.bot_customers(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  txn_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ
);

-- Bot orders
CREATE TABLE public.bot_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.bot_customers(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.bot_products(id) NOT NULL,
  product_name TEXT NOT NULL,
  quantity INT NOT NULL,
  total_price DECIMAL(12,2) NOT NULL,
  details JSONB,
  row_numbers INT[],
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Telegram bot state for polling
CREATE TABLE public.telegram_bot_state (
  id INT PRIMARY KEY CHECK (id = 1),
  update_offset BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0);

-- Enable RLS
ALTER TABLE public.bot_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

-- Service role policies (edge functions use service role)
CREATE POLICY "Service role full access" ON public.bot_customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_deposits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.bot_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.telegram_bot_state FOR ALL USING (true) WITH CHECK (true);
