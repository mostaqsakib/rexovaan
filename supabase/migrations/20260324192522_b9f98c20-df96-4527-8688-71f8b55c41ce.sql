CREATE TABLE public.bot_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '💳',
  payment_type text NOT NULL DEFAULT 'wallet',
  payment_details text NOT NULL,
  instruction text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.bot_payment_methods
  FOR ALL TO public
  USING (true) WITH CHECK (true);

-- Seed default payment methods
INSERT INTO public.bot_payment_methods (name, emoji, payment_type, payment_details, sort_order) VALUES
  ('Binance Pay', '🟡', 'binance_id', 'BINANCE_ID', 0),
  ('USDT (BEP20 - BSC)', '🔵', 'wallet_bep20', 'USDT_WALLET_ADDRESS', 1);
