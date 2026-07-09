
ALTER TABLE public.bep20_reserved_addresses
  ADD COLUMN IF NOT EXISTS sweep_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sweep_tx_hash text,
  ADD COLUMN IF NOT EXISTS gas_tx_hash text,
  ADD COLUMN IF NOT EXISTS swept_at timestamptz,
  ADD COLUMN IF NOT EXISTS sweep_attempts int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sweep_last_error text,
  ADD COLUMN IF NOT EXISTS sweep_last_try_at timestamptz;

CREATE INDEX IF NOT EXISTS bep20_reserved_addresses_sweep_idx
  ON public.bep20_reserved_addresses (status, sweep_status)
  WHERE status = 'paid';
