
-- Settings singleton
CREATE TABLE public.bep20_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sweep_destination TEXT NOT NULL DEFAULT '0xefbDe79E25D1DF2F54C1851F670EF3ef33E322e3',
  next_index INT NOT NULL DEFAULT 1,
  watcher_last_block BIGINT NOT NULL DEFAULT 0,
  min_gas_balance NUMERIC NOT NULL DEFAULT 0.005,
  address_ttl_minutes INT NOT NULL DEFAULT 30,
  confirmations_required INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.bep20_settings TO service_role;
ALTER TABLE public.bep20_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bep20_settings service_role only" ON public.bep20_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
INSERT INTO public.bep20_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Reserved addresses per deposit request
CREATE TABLE public.bep20_reserved_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.bot_customers(id) ON DELETE SET NULL,
  deposit_id UUID REFERENCES public.bot_deposits(id) ON DELETE SET NULL,
  address TEXT NOT NULL UNIQUE,
  derivation_index INT NOT NULL UNIQUE,
  token TEXT NOT NULL CHECK (token IN ('USDT','USDC','ANY')),
  expected_amount NUMERIC NOT NULL,
  received_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','swept')),
  tx_hash TEXT,
  sweep_tx_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  swept_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bep20_reserved_status ON public.bep20_reserved_addresses(status);
CREATE INDEX idx_bep20_reserved_address ON public.bep20_reserved_addresses(lower(address));
CREATE INDEX idx_bep20_reserved_customer ON public.bep20_reserved_addresses(customer_id);
GRANT ALL ON public.bep20_reserved_addresses TO service_role;
ALTER TABLE public.bep20_reserved_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bep20_reserved service_role only" ON public.bep20_reserved_addresses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Payment registry (idempotency)
CREATE TABLE public.bep20_payment_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash TEXT NOT NULL,
  log_index INT NOT NULL,
  address TEXT NOT NULL,
  token TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  block_number BIGINT NOT NULL,
  reserved_address_id UUID REFERENCES public.bep20_reserved_addresses(id) ON DELETE SET NULL,
  deposit_id UUID REFERENCES public.bot_deposits(id) ON DELETE SET NULL,
  credited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX idx_bep20_registry_address ON public.bep20_payment_registry(lower(address));
GRANT ALL ON public.bep20_payment_registry TO service_role;
ALTER TABLE public.bep20_payment_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bep20_registry service_role only" ON public.bep20_payment_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Extend bot_deposits
ALTER TABLE public.bot_deposits
  ADD COLUMN IF NOT EXISTS bep20_address TEXT,
  ADD COLUMN IF NOT EXISTS bep20_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS bep20_token TEXT;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.bep20_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_bep20_settings_updated BEFORE UPDATE ON public.bep20_settings
  FOR EACH ROW EXECUTE FUNCTION public.bep20_touch_updated_at();
CREATE TRIGGER trg_bep20_reserved_updated BEFORE UPDATE ON public.bep20_reserved_addresses
  FOR EACH ROW EXECUTE FUNCTION public.bep20_touch_updated_at();

-- Atomic derivation-index increment (used by reserve edge fn)
CREATE OR REPLACE FUNCTION public.bep20_next_index()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_idx INT;
BEGIN
  UPDATE public.bep20_settings SET next_index = next_index + 1 WHERE id = 1
    RETURNING next_index - 1 INTO v_idx;
  RETURN v_idx;
END; $$;
REVOKE ALL ON FUNCTION public.bep20_next_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bep20_next_index() TO service_role;
