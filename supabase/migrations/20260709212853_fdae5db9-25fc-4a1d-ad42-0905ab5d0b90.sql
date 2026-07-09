
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.ton_reserved_deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL,
  deposit_id UUID,
  memo TEXT NOT NULL UNIQUE,
  expected_amount NUMERIC(20,6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  received_amount NUMERIC(20,6) NOT NULL DEFAULT 0,
  tx_hash TEXT,
  from_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ton_reserved_deposits_customer_idx ON public.ton_reserved_deposits(customer_id);
CREATE INDEX ton_reserved_deposits_status_idx ON public.ton_reserved_deposits(status);
CREATE INDEX ton_reserved_deposits_memo_idx ON public.ton_reserved_deposits(memo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ton_reserved_deposits TO authenticated;
GRANT ALL ON public.ton_reserved_deposits TO service_role;

ALTER TABLE public.ton_reserved_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage TON reservations"
ON public.ton_reserved_deposits FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Customers can view own TON reservations"
ON public.ton_reserved_deposits FOR SELECT
USING (customer_id::text = auth.uid()::text);

CREATE TRIGGER ton_reserved_deposits_updated_at
BEFORE UPDATE ON public.ton_reserved_deposits
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.bot_payment_methods
  (name, payment_details, payment_type, sort_order, is_active, enabled_for_deposit, enabled_for_purchase, emoji, custom_emoji_id, instruction)
VALUES (
  'USDT TON', 'auto', 'ton_auto', 4, true, true, true, '💎', NULL,
  'Send USDT (TON network / Jetton) with the exact memo/comment shown. Auto-verified within ~30 seconds after on-chain confirmation.'
);
