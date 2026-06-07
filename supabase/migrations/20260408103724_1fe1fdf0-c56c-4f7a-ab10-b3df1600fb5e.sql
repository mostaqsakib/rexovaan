ALTER TABLE public.bot_customers 
  ADD COLUMN pay_later_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN pay_later_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN pay_later_used numeric NOT NULL DEFAULT 0;