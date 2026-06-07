
-- Atomic refund of customer balance (locks row, prevents concurrent clobber)
CREATE OR REPLACE FUNCTION public.refund_customer_balance(_customer_id uuid, _amount numeric)
RETURNS TABLE(success boolean, new_balance numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur_balance numeric;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  SELECT balance INTO cur_balance FROM public.bot_customers WHERE id = _customer_id FOR UPDATE;
  IF cur_balance IS NULL THEN RETURN QUERY SELECT false, 0::numeric; RETURN; END IF;
  UPDATE public.bot_customers SET balance = cur_balance + _amount, updated_at = now() WHERE id = _customer_id;
  RETURN QUERY SELECT true, (cur_balance + _amount);
END; $$;

-- Atomic refund of pay-later credit (decrements used, floors at 0)
CREATE OR REPLACE FUNCTION public.refund_pay_later_credit(_customer_id uuid, _amount numeric)
RETURNS TABLE(success boolean, new_used numeric, limit_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur_used numeric; cur_limit numeric;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  SELECT pay_later_used, pay_later_limit INTO cur_used, cur_limit FROM public.bot_customers WHERE id = _customer_id FOR UPDATE;
  IF cur_used IS NULL THEN RETURN QUERY SELECT false, 0::numeric, 0::numeric; RETURN; END IF;
  UPDATE public.bot_customers SET pay_later_used = GREATEST(0, cur_used - _amount), updated_at = now() WHERE id = _customer_id;
  RETURN QUERY SELECT true, GREATEST(0, cur_used - _amount), COALESCE(cur_limit, 0);
END; $$;

-- Atomic claim of pending_delivery order to prevent double-cancel by admin
CREATE OR REPLACE FUNCTION public.claim_pending_delivery_order(_order_id uuid, _new_status text)
RETURNS TABLE(claimed boolean, customer_id uuid, total_price numeric, payment_method text, product_name text, quantity integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  UPDATE public.bot_orders SET status = _new_status
  WHERE id = _order_id AND status = 'pending_delivery'
  RETURNING bot_orders.customer_id, bot_orders.total_price, bot_orders.payment_method, bot_orders.product_name, bot_orders.quantity
  INTO r;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::numeric, NULL::text, NULL::text, 0;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, r.customer_id, r.total_price, r.payment_method, r.product_name, r.quantity;
END; $$;
