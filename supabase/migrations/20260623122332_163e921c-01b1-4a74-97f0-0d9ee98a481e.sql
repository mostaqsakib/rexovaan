
-- ============================================================
-- SECURITY HARDENING MIGRATION
-- ============================================================

-- C1: Revoke balance/stock RPCs from PUBLIC/anon/authenticated
REVOKE EXECUTE ON FUNCTION public.deduct_customer_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deduct_customer_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_customer_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_customer_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.deduct_pay_later_credit(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deduct_pay_later_credit(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_pay_later_credit(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_pay_later_credit(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reserve_internal_stock_items(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_internal_stock_items(uuid, integer, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.restore_internal_stock_items(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_internal_stock_items(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_pending_delivery_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_pending_delivery_order(uuid, text) TO service_role;

-- M4: link-check RPCs
REVOKE EXECUTE ON FUNCTION public.mark_link_check_result(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_link_check_result(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_next_link_check_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_next_link_check_item(uuid) TO service_role;

-- M5 + C1 reseller order RPCs (both overloads)
REVOKE EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text, numeric) TO service_role;

-- C2: get_bot_quick_stats — anonymous/customer must not see revenue and top buyers
REVOKE EXECUTE ON FUNCTION public.get_bot_quick_stats(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_bot_quick_stats(timestamptz, timestamptz, timestamptz) TO service_role;

-- C3: get_product_stock_items — exposes deliverable data
REVOKE EXECUTE ON FUNCTION public.get_product_stock_items(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_product_stock_items(uuid) TO service_role;

-- H14: google_account_cookies — restrict table grants to service_role only
REVOKE ALL ON public.google_account_cookies FROM authenticated, anon, PUBLIC;
GRANT  ALL ON public.google_account_cookies TO service_role;

-- H1: prevent deposit double-credit
DROP INDEX IF EXISTS uq_bot_deposits_txn_hash_live;
CREATE UNIQUE INDEX uq_bot_deposits_txn_hash_live
  ON public.bot_deposits (txn_hash)
  WHERE txn_hash IS NOT NULL
    AND status NOT IN ('rejected','bkash_cancelled');

-- C9: atomic withdrawal-create function (replaces 2-step client flow)
CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(
  _customer_id uuid,
  _amount numeric,
  _payment_details text,
  _network text,
  _asset text
)
RETURNS TABLE(withdrawal_id uuid, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_balance numeric;
  is_banned_flag boolean;
  new_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF _payment_details IS NULL OR length(btrim(_payment_details)) = 0 THEN
    RAISE EXCEPTION 'Payment details required';
  END IF;

  SELECT balance, COALESCE(is_banned,false) INTO cur_balance, is_banned_flag
  FROM public.bot_customers WHERE id = _customer_id FOR UPDATE;

  IF cur_balance IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
  IF is_banned_flag THEN
    RAISE EXCEPTION 'Account is banned';
  END IF;
  IF cur_balance < _amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  INSERT INTO public.bot_withdrawals (customer_id, amount, payment_details, network, asset, status)
  VALUES (_customer_id, _amount, btrim(_payment_details), COALESCE(_network,'TRC20'), COALESCE(_asset,'USDT'), 'pending')
  RETURNING id INTO new_id;

  UPDATE public.bot_customers
  SET balance = cur_balance - _amount, updated_at = now()
  WHERE id = _customer_id;

  RETURN QUERY SELECT new_id, (cur_balance - _amount);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_withdrawal_atomic(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_withdrawal_atomic(uuid, numeric, text, text, text) TO service_role;

-- C9 cont.: remove direct customer INSERT on bot_withdrawals so the path is only via the edge function
DROP POLICY IF EXISTS "Customers insert own withdrawals" ON public.bot_withdrawals;
