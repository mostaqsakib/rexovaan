
-- Referrals tracking table
CREATE TABLE public.bot_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.bot_customers(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES public.bot_customers(id) ON DELETE CASCADE,
  first_bonus_paid boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(referred_id)
);

ALTER TABLE public.bot_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.bot_referrals FOR ALL USING (true) WITH CHECK (true);

-- Referral earnings log
CREATE TABLE public.bot_referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.bot_customers(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES public.bot_customers(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  type text NOT NULL DEFAULT 'commission',
  source_order_id uuid REFERENCES public.bot_orders(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_referral_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.bot_referral_earnings FOR ALL USING (true) WITH CHECK (true);

-- Add referral balance columns to bot_customers
ALTER TABLE public.bot_customers
  ADD COLUMN referral_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN referral_total_earned numeric NOT NULL DEFAULT 0,
  ADD COLUMN referral_transferred numeric NOT NULL DEFAULT 0;
