CREATE TABLE public.bep20_fake_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  address TEXT NOT NULL,
  contract TEXT NOT NULL,
  token_symbol TEXT,
  amount NUMERIC,
  raw_amount TEXT,
  from_address TEXT,
  block_number BIGINT,
  reserved_address_id UUID REFERENCES public.bep20_reserved_addresses(id) ON DELETE SET NULL,
  customer_id UUID,
  deposit_id UUID,
  reason TEXT NOT NULL DEFAULT 'fake_token_detected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);

GRANT SELECT ON public.bep20_fake_transactions TO authenticated;
GRANT ALL ON public.bep20_fake_transactions TO service_role;

ALTER TABLE public.bep20_fake_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view fake transactions"
  ON public.bep20_fake_transactions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_bep20_fake_created_at ON public.bep20_fake_transactions (created_at DESC);
CREATE INDEX idx_bep20_fake_address ON public.bep20_fake_transactions (address);