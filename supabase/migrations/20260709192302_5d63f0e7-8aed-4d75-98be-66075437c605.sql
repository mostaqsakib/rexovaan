
-- Per-chain watcher state
CREATE TABLE IF NOT EXISTS public.evm_chain_state (
  chain text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  last_block bigint NOT NULL DEFAULT 0,
  confirmations integer NOT NULL DEFAULT 6,
  chunk_size integer NOT NULL DEFAULT 4000,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_chain_state TO authenticated;
GRANT ALL ON public.evm_chain_state TO service_role;

ALTER TABLE public.evm_chain_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage evm chain state"
  ON public.evm_chain_state FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default chains (disabled unless RPC configured in code)
INSERT INTO public.evm_chain_state(chain, enabled, confirmations) VALUES
  ('bsc',       true,  3),
  ('polygon',   true,  20),
  ('arbitrum',  true,  1),
  ('optimism',  true,  1),
  ('base',      true,  1),
  ('ethereum',  true,  6),
  ('avalanche', true,  3)
ON CONFLICT (chain) DO NOTHING;

-- Add chain column to payment registry (default 'bsc' for existing rows)
ALTER TABLE public.bep20_payment_registry
  ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'bsc';

-- Rebuild unique constraint to include chain (multi-chain idempotency)
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.bep20_payment_registry'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 2;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bep20_payment_registry DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bep20_payment_registry_chain_tx_uidx
  ON public.bep20_payment_registry(chain, tx_hash, log_index);

-- Add chain column to fake tx table
ALTER TABLE public.bep20_fake_transactions
  ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'bsc';

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.bep20_fake_transactions'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 2;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bep20_fake_transactions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bep20_fake_tx_chain_tx_uidx
  ON public.bep20_fake_transactions(chain, tx_hash, log_index);

-- Track which chains a reservation actually received funds on (wrong-network detection)
ALTER TABLE public.bep20_reserved_addresses
  ADD COLUMN IF NOT EXISTS received_chains text[] NOT NULL DEFAULT '{}';

-- Gas tank monitor alert log (dedup so we don't spam admin every 2 min)
CREATE TABLE IF NOT EXISTS public.evm_gas_alerts (
  chain text PRIMARY KEY,
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  last_balance numeric
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_gas_alerts TO authenticated;
GRANT ALL ON public.evm_gas_alerts TO service_role;

ALTER TABLE public.evm_gas_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view gas alerts"
  ON public.evm_gas_alerts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
