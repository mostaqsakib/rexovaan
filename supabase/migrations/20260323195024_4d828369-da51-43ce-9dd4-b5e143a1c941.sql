
CREATE TABLE public.bot_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.bot_customers(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  payment_details text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  proof_url text,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.bot_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.bot_withdrawals FOR ALL USING (true) WITH CHECK (true);
