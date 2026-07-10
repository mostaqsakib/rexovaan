
ALTER TABLE public.ltc_reserved_addresses
  ADD COLUMN IF NOT EXISTS sweep_status text,
  ADD COLUMN IF NOT EXISTS sweep_tx_hash text,
  ADD COLUMN IF NOT EXISTS swept_amount_ltc numeric,
  ADD COLUMN IF NOT EXISTS swept_at timestamptz,
  ADD COLUMN IF NOT EXISTS sweep_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_error text;

CREATE INDEX IF NOT EXISTS idx_ltc_reserved_sweep_status
  ON public.ltc_reserved_addresses (sweep_status) WHERE status = 'paid';
