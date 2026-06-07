-- Add payment tracking to orders
ALTER TABLE public.bot_orders
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS txn_hash text;

-- Atomic balance deduction with row-level lock to prevent double-spend races
CREATE OR REPLACE FUNCTION public.deduct_customer_balance(_customer_id uuid, _amount numeric)
RETURNS TABLE(success boolean, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_balance numeric;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT balance INTO cur_balance
  FROM public.bot_customers
  WHERE id = _customer_id
  FOR UPDATE;

  IF cur_balance IS NULL THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;

  IF cur_balance < _amount THEN
    RETURN QUERY SELECT false, cur_balance;
    RETURN;
  END IF;

  UPDATE public.bot_customers
  SET balance = cur_balance - _amount, updated_at = now()
  WHERE id = _customer_id;

  RETURN QUERY SELECT true, (cur_balance - _amount);
END;
$$;

-- Atomic pay-later credit deduction
CREATE OR REPLACE FUNCTION public.deduct_pay_later_credit(_customer_id uuid, _amount numeric)
RETURNS TABLE(success boolean, new_used numeric, limit_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_used numeric;
  cur_limit numeric;
  cur_enabled boolean;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT pay_later_used, pay_later_limit, pay_later_enabled
  INTO cur_used, cur_limit, cur_enabled
  FROM public.bot_customers
  WHERE id = _customer_id
  FOR UPDATE;

  IF cur_used IS NULL OR cur_enabled IS NOT TRUE THEN
    RETURN QUERY SELECT false, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  IF (cur_limit - cur_used) < _amount THEN
    RETURN QUERY SELECT false, cur_used, cur_limit;
    RETURN;
  END IF;

  UPDATE public.bot_customers
  SET pay_later_used = cur_used + _amount, updated_at = now()
  WHERE id = _customer_id;

  RETURN QUERY SELECT true, (cur_used + _amount), cur_limit;
END;
$$;