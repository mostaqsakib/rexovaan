
-- CRITICAL SECURITY FIX: checkout_balance_atomic was callable by anyone (PUBLIC + authenticated)
-- with an arbitrary _customer_id, allowing balance theft + stock exfiltration.
-- Lock execution down to service_role only (edge function uses service role).

REVOKE EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) TO service_role;

-- Defense-in-depth: also enforce ownership inside the function body so a future
-- accidental GRANT cannot re-open the hole. Only allow when:
--   (a) caller is service_role (no auth.uid()), OR
--   (b) caller's auth.uid() owns the target customer row.
CREATE OR REPLACE FUNCTION public.checkout_balance_atomic(
  _customer_id uuid,
  _product_id uuid,
  _quantity integer,
  _expected_unit numeric,
  _idempotency_key text
)
 RETURNS TABLE(order_id uuid, total_price numeric, unit_price numeric, details jsonb, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer        public.bot_customers%ROWTYPE;
  v_product         public.bot_products%ROWTYPE;
  v_unit            numeric;
  v_total           numeric;
  v_order_id        uuid;
  v_details         jsonb;
  v_picked          integer;
  v_existing        public.bot_orders%ROWTYPE;
  v_balance_before  numeric;
  v_balance_after   numeric;
  v_caller          uuid;
  v_owner           uuid;
BEGIN
  PERFORM set_config('statement_timeout', '5000', true);
  PERFORM set_config('lock_timeout',      '3000', true);
  PERFORM set_config('idle_in_transaction_session_timeout', '5000', true);

  v_caller := auth.uid();

  -- AUTHORIZATION GUARD: caller must either be service_role (auth.uid() IS NULL
  -- because service-role JWTs don't set it) OR own the target customer.
  IF v_caller IS NOT NULL THEN
    SELECT auth_user_id INTO v_owner FROM public.bot_customers WHERE id = _customer_id;
    IF v_owner IS NULL OR v_owner <> v_caller THEN
      RAISE EXCEPTION 'Forbidden: customer mismatch' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF _quantity IS NULL OR _quantity < 1 OR _quantity > 500 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;
  IF _idempotency_key IS NULL OR length(btrim(_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'Missing idempotency key';
  END IF;

  SELECT * INTO v_existing FROM public.bot_orders
  WHERE customer_id = _customer_id AND idempotency_key = _idempotency_key LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO public.checkout_audit_logs(
      order_id, customer_id, product_id, quantity, unit_price, total_price,
      idempotency_key, reserved_count, was_idempotent_hit, outcome, created_by
    ) VALUES (
      v_existing.id, _customer_id, _product_id, v_existing.quantity,
      ROUND(v_existing.total_price / NULLIF(v_existing.quantity, 0), 4),
      v_existing.total_price, _idempotency_key,
      COALESCE(jsonb_array_length(v_existing.details), 0),
      true, 'replay', v_caller
    );
    RETURN QUERY
      SELECT v_existing.id,
             v_existing.total_price,
             ROUND(v_existing.total_price / NULLIF(v_existing.quantity, 0), 4),
             v_existing.details,
             (SELECT balance FROM public.bot_customers WHERE id = _customer_id);
    RETURN;
  END IF;

  SELECT * INTO v_customer FROM public.bot_customers WHERE id = _customer_id FOR UPDATE;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF COALESCE(v_customer.is_banned, false) THEN RAISE EXCEPTION 'Account banned'; END IF;
  v_balance_before := COALESCE(v_customer.balance, 0);

  SELECT * INTO v_product FROM public.bot_products WHERE id = _product_id FOR UPDATE;
  IF v_product.id IS NULL OR v_product.is_active = false THEN RAISE EXCEPTION 'Product not available'; END IF;
  IF v_product.is_manual_delivery = true THEN RAISE EXCEPTION 'Manual delivery only'; END IF;

  SELECT MIN(v) INTO v_unit FROM unnest(ARRAY[
    v_product.price,
    (SELECT pp.price FROM public.bot_product_pricing pp
       WHERE pp.product_id = _product_id AND pp.min_quantity <= _quantity
         AND (pp.max_quantity IS NULL OR pp.max_quantity >= _quantity)
       ORDER BY pp.price ASC, pp.min_quantity DESC LIMIT 1),
    (SELECT cp.price FROM public.bot_customer_pricing cp
       WHERE cp.customer_id = _customer_id AND cp.product_id = _product_id
         AND cp.is_active = true AND cp.min_quantity <= _quantity
       ORDER BY cp.price ASC, cp.min_quantity DESC LIMIT 1),
    (SELECT fs.sale_price FROM public.bot_flash_sales fs
       WHERE fs.product_id = _product_id AND fs.is_active = true
         AND COALESCE(fs.pending_delete, false) = false
         AND fs.starts_at <= now() AND fs.ends_at >= now()
       ORDER BY fs.sale_price ASC LIMIT 1)
  ]) AS c(v) WHERE v IS NOT NULL AND v > 0;

  IF v_unit IS NULL OR v_unit <= 0 THEN RAISE EXCEPTION 'Product not purchasable'; END IF;
  IF _expected_unit IS NOT NULL AND _expected_unit > 0 AND v_unit > (_expected_unit + 0.001) THEN
    RAISE EXCEPTION 'Price changed, please refresh';
  END IF;

  v_total := ROUND(v_unit * _quantity, 2);
  IF v_balance_before < v_total THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  INSERT INTO public.bot_orders (
    customer_id, product_id, product_name, quantity,
    total_price, payment_method, status, details, row_numbers,
    source, idempotency_key
  ) VALUES (
    _customer_id, _product_id, v_product.name, _quantity,
    v_total, 'balance', 'completed', '[]'::jsonb, ARRAY[]::integer[],
    'web', _idempotency_key
  ) RETURNING id INTO v_order_id;

  WITH picked AS (
    SELECT s.id, s.data FROM public.bot_product_stock_items s
    WHERE s.product_id = _product_id AND s.status = 'available'
    ORDER BY s.sort_index, s.id LIMIT _quantity FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.bot_product_stock_items s
    SET status='sold', sold_order_id=v_order_id, sold_at=now(), updated_at=now()
    FROM picked WHERE s.id = picked.id
    RETURNING s.data
  )
  SELECT COALESCE(jsonb_agg(data), '[]'::jsonb), count(*)::int
  INTO v_details, v_picked FROM upd;

  IF v_picked < _quantity THEN RAISE EXCEPTION 'Not enough stock'; END IF;

  v_balance_after := v_balance_before - v_total;
  UPDATE public.bot_customers SET balance = v_balance_after, updated_at = now() WHERE id = _customer_id;

  INSERT INTO public.wallet_ledger(
    customer_id, amount, type, reference_order_id, reference_table, reference_id,
    balance_before, balance_after, idempotency_key, note, created_by
  ) VALUES (
    _customer_id, -v_total, 'purchase', v_order_id, 'bot_orders', v_order_id,
    v_balance_before, v_balance_after, _idempotency_key,
    'Web checkout: ' || v_product.name || ' x' || _quantity,
    v_caller
  );

  UPDATE public.bot_orders SET details = v_details, delivered_at = now() WHERE id = v_order_id;

  INSERT INTO public.checkout_audit_logs(
    order_id, customer_id, product_id, quantity, unit_price, total_price,
    idempotency_key, reserved_count, was_idempotent_hit, outcome, created_by
  ) VALUES (
    v_order_id, _customer_id, _product_id, _quantity, v_unit, v_total,
    _idempotency_key, v_picked, false, 'completed', v_caller
  );

  RETURN QUERY SELECT v_order_id, v_total, v_unit, v_details, v_balance_after;
END;
$function$;

-- Re-revoke after CREATE OR REPLACE (CREATE resets some grants on some PG versions)
REVOKE EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) TO service_role;
