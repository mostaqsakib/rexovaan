CREATE TABLE public.bot_balance_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL,
  old_balance numeric NOT NULL,
  new_balance numeric NOT NULL,
  diff numeric NOT NULL,
  note text NOT NULL,
  source text NOT NULL DEFAULT 'admin',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_balance_adjustments_customer ON public.bot_balance_adjustments(customer_id, created_at DESC);

ALTER TABLE public.bot_balance_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access balance adjustments"
ON public.bot_balance_adjustments FOR ALL USING (true) WITH CHECK (true);