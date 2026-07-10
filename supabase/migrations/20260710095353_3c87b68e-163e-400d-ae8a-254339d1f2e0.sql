
-- 1. ltc_settings (singleton)
CREATE TABLE public.ltc_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  xpub text,
  script_type text NOT NULL DEFAULT 'bip84',
  next_index integer NOT NULL DEFAULT 0,
  watcher_last_height bigint NOT NULL DEFAULT 0,
  min_confirmations integer NOT NULL DEFAULT 2,
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.ltc_settings TO authenticated;
GRANT ALL ON public.ltc_settings TO service_role;
ALTER TABLE public.ltc_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ltc_settings" ON public.ltc_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update ltc_settings" ON public.ltc_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.ltc_settings (script_type) VALUES ('bip84');

-- 2. ltc_reserved_addresses
CREATE TABLE public.ltc_reserved_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text,
  deposit_id uuid,
  customer_telegram_id bigint,
  address text NOT NULL UNIQUE,
  derivation_index integer NOT NULL,
  expected_amount_ltc numeric(20,8) NOT NULL,
  expected_amount_usd numeric(20,4) NOT NULL,
  ltc_usd_rate numeric(20,4) NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | paid | expired
  paid_tx_hash text,
  paid_amount_ltc numeric(20,8),
  paid_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ltc_reserved_status_idx ON public.ltc_reserved_addresses(status, expires_at);
CREATE INDEX ltc_reserved_deposit_idx ON public.ltc_reserved_addresses(deposit_id);
GRANT SELECT ON public.ltc_reserved_addresses TO authenticated;
GRANT ALL ON public.ltc_reserved_addresses TO service_role;
ALTER TABLE public.ltc_reserved_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ltc_reserved" ON public.ltc_reserved_addresses FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. ltc_payment_registry
CREATE TABLE public.ltc_payment_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash text NOT NULL,
  vout integer NOT NULL,
  address text NOT NULL,
  amount_ltc numeric(20,8) NOT NULL,
  block_height bigint,
  confirmations integer,
  reserved_address_id uuid REFERENCES public.ltc_reserved_addresses(id) ON DELETE SET NULL,
  deposit_id uuid,
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, vout)
);
CREATE INDEX ltc_registry_address_idx ON public.ltc_payment_registry(address);
GRANT SELECT ON public.ltc_payment_registry TO authenticated;
GRANT ALL ON public.ltc_payment_registry TO service_role;
ALTER TABLE public.ltc_payment_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ltc_registry" ON public.ltc_payment_registry FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. bot_deposits columns
ALTER TABLE public.bot_deposits
  ADD COLUMN IF NOT EXISTS ltc_address text,
  ADD COLUMN IF NOT EXISTS ltc_tx_hash text;

-- 5. updated_at trigger
CREATE TRIGGER trg_ltc_settings_updated BEFORE UPDATE ON public.ltc_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ltc_reserved_updated BEFORE UPDATE ON public.ltc_reserved_addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Atomic next_index bumper
CREATE OR REPLACE FUNCTION public.ltc_next_index()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_idx integer;
BEGIN
  UPDATE public.ltc_settings
     SET next_index = next_index + 1
   WHERE singleton = true
   RETURNING next_index - 1 INTO next_idx;
  RETURN next_idx;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ltc_next_index() TO service_role;
