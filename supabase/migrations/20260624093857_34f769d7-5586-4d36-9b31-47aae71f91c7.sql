-- Security fixes for reseller API, atomic checkout default, and bind code hardening

-- Telegram bind-code failed-attempt counter (actual table name in this project)
ALTER TABLE public.bot_telegram_bind_codes
ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;

-- Reseller API duplicate external order protection
CREATE UNIQUE INDEX IF NOT EXISTS bot_reseller_orders_external_unique
  ON public.bot_reseller_orders (reseller_id, external_order_id)
  WHERE external_order_id IS NOT NULL;

-- Default web checkout to the atomic path
INSERT INTO public.bot_settings (key, value)
VALUES ('use_atomic_checkout', 'true')
ON CONFLICT (key) DO UPDATE SET value = 'true';

-- Reserve/deduct balance BEFORE fulfilling a source-backed reseller API order.
-- This serializes per reseller via row locks and creates the API order before the external purchase.
CREATE OR REPLACE FUNCTION public.reserve_reseller_source_api_order(
  _api_key_hash text,
  _product_id uuid,
  _quantity integer,
  _external_order_id text DEFAULT NULL
)
RETURNS TABLE(
  order_id uuid,
  product_id uuid,
  product_name text,
  quantity integer,
  unit_cost numeric,
  total_cost numeric,
  balance_after numeric,
  customer_id uuid,
  customer_chat_id bigint,
  customer_username text,
  customer_first_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  reseller_row public.bot_resellers%ROWTYPE;
  customer_row public.bot_customers%ROWTYPE;
  product_row public.bot_products%ROWTYPE;
  tier_unit numeric;
  special_unit numeric;
  effective_unit numeric;
  computed_total numeric;
  available_balance numeric;
  new_balance numeric;
  recent_orders integer;
  new_order_id uuid;
BEGIN
  PERFORM set_config('statement_timeout', '10000', true);
  PERFORM set_config('lock_timeout', '3000', true);

  IF _api_key_hash IS NULL OR length(_api_key_hash) < 32 THEN
    RAISE EXCEPTION 'Invalid API key';
  END IF;

  IF _quantity IS NULL OR _quantity <= 0 OR _quantity > 100 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 100';
  END IF;

  SELECT * INTO reseller_row
  FROM public.bot_resellers
  WHERE api_key_hash = _api_key_hash
  FOR UPDATE;

  IF reseller_row.id IS NULL OR reseller_row.is_active = false THEN
    RAISE EXCEPTION 'Reseller account is not active';
  END IF;

  SELECT COUNT(*)::integer INTO recent_orders
  FROM public.bot_reseller_orders
  WHERE reseller_id = reseller_row.id
    AND created_at >= now() - interval '60 seconds';

  IF recent_orders >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded. Maximum 10 orders per minute.';
  END IF;

  IF _external_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bot_reseller_orders
    WHERE reseller_id = reseller_row.id AND external_order_id = _external_order_id
  ) THEN
    RAISE EXCEPTION 'Duplicate external order id';
  END IF;

  IF reseller_row.customer_id IS NOT NULL THEN
    SELECT * INTO customer_row
    FROM public.bot_customers
    WHERE id = reseller_row.customer_id
    FOR UPDATE;

    IF customer_row.id IS NULL THEN
      RAISE EXCEPTION 'Linked customer account not found';
    END IF;

    IF COALESCE(customer_row.is_banned, false) THEN
      RAISE EXCEPTION 'Linked customer account is banned';
    END IF;

    available_balance := COALESCE(customer_row.balance, 0);
  ELSE
    available_balance := COALESCE(reseller_row.balance, 0);
  END IF;

  SELECT * INTO product_row
  FROM public.bot_products
  WHERE id = _product_id AND is_active = true
  FOR UPDATE;

  IF product_row.id IS NULL THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  IF product_row.is_manual_delivery = true THEN
    RAISE EXCEPTION 'Manual delivery products are not available via reseller API';
  END IF;

  IF product_row.source_id IS NULL OR product_row.source_product_id IS NULL THEN
    RAISE EXCEPTION 'Product is not source-backed';
  END IF;

  SELECT pp.price INTO tier_unit
  FROM public.bot_product_pricing pp
  WHERE pp.product_id = product_row.id
    AND pp.min_quantity <= _quantity
    AND (pp.max_quantity IS NULL OR pp.max_quantity >= _quantity)
    AND pp.price > 0
  ORDER BY pp.price ASC, pp.min_quantity DESC
  LIMIT 1;

  IF reseller_row.customer_id IS NOT NULL THEN
    SELECT cp.price INTO special_unit
    FROM public.bot_customer_pricing cp
    WHERE cp.customer_id = reseller_row.customer_id
      AND cp.product_id = product_row.id
      AND cp.is_active = true
      AND cp.min_quantity <= _quantity
      AND cp.price > 0
    ORDER BY cp.min_quantity DESC, cp.price ASC
    LIMIT 1;
  END IF;

  -- Reseller pricing rule: customer-special is an override; otherwise use lowest base/tier.
  -- Flash sales are intentionally excluded from reseller API pricing.
  IF special_unit IS NOT NULL AND special_unit > 0 THEN
    effective_unit := special_unit;
  ELSE
    SELECT MIN(v) INTO effective_unit
    FROM unnest(ARRAY[product_row.price, tier_unit]) AS candidate(v)
    WHERE v IS NOT NULL AND v > 0;
  END IF;

  IF effective_unit IS NULL OR effective_unit <= 0 THEN
    RAISE EXCEPTION 'Product not purchasable';
  END IF;

  computed_total := ROUND(effective_unit * _quantity, 2);

  IF available_balance < computed_total THEN
    RAISE EXCEPTION 'Insufficient reseller balance';
  END IF;

  new_balance := ROUND(available_balance - computed_total, 2);

  IF reseller_row.customer_id IS NOT NULL THEN
    UPDATE public.bot_customers
    SET balance = new_balance,
        updated_at = now()
    WHERE id = reseller_row.customer_id;
  END IF;

  UPDATE public.bot_resellers
  SET balance = new_balance,
      updated_at = now()
  WHERE id = reseller_row.id;

  INSERT INTO public.bot_reseller_orders (
    reseller_id, product_id, product_name, quantity, unit_cost, total_cost, external_order_id, status, details
  ) VALUES (
    reseller_row.id, product_row.id, product_row.name, _quantity, effective_unit, computed_total, _external_order_id, 'processing', '[]'::jsonb
  ) RETURNING id INTO new_order_id;

  INSERT INTO public.bot_reseller_balance_transactions (
    reseller_id, order_id, type, amount, balance_after, note
  ) VALUES (
    reseller_row.id, new_order_id, 'order_debit', -computed_total, new_balance, 'Reseller API source order reserved'
  );

  RETURN QUERY
  SELECT new_order_id, product_row.id, product_row.name, _quantity, effective_unit, computed_total, new_balance,
         customer_row.id, customer_row.chat_id, customer_row.username, customer_row.first_name;
END;
$$;

-- Refund a source-backed reseller API reservation when external source fulfillment fails.
CREATE OR REPLACE FUNCTION public.refund_reseller_source_api_order(
  _order_id uuid,
  _reason text DEFAULT NULL
)
RETURNS TABLE(success boolean, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  order_row public.bot_reseller_orders%ROWTYPE;
  reseller_row public.bot_resellers%ROWTYPE;
  customer_row public.bot_customers%ROWTYPE;
  cur_balance numeric;
  new_balance numeric;
BEGIN
  PERFORM set_config('statement_timeout', '10000', true);
  PERFORM set_config('lock_timeout', '3000', true);

  SELECT * INTO order_row
  FROM public.bot_reseller_orders
  WHERE id = _order_id
  FOR UPDATE;

  IF order_row.id IS NULL THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;

  IF order_row.status <> 'processing' THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;

  SELECT * INTO reseller_row
  FROM public.bot_resellers
  WHERE id = order_row.reseller_id
  FOR UPDATE;

  IF reseller_row.id IS NULL THEN
    RETURN QUERY SELECT false, 0::numeric;
    RETURN;
  END IF;

  IF reseller_row.customer_id IS NOT NULL THEN
    SELECT * INTO customer_row
    FROM public.bot_customers
    WHERE id = reseller_row.customer_id
    FOR UPDATE;

    cur_balance := COALESCE(customer_row.balance, 0);
    new_balance := ROUND(cur_balance + COALESCE(order_row.total_cost, 0), 2);

    UPDATE public.bot_customers
    SET balance = new_balance,
        updated_at = now()
    WHERE id = reseller_row.customer_id;
  ELSE
    cur_balance := COALESCE(reseller_row.balance, 0);
    new_balance := ROUND(cur_balance + COALESCE(order_row.total_cost, 0), 2);
  END IF;

  UPDATE public.bot_resellers
  SET balance = new_balance,
      updated_at = now()
  WHERE id = reseller_row.id;

  UPDATE public.bot_reseller_orders
  SET status = 'failed'
  WHERE id = order_row.id;

  INSERT INTO public.bot_reseller_balance_transactions (
    reseller_id, order_id, type, amount, balance_after, note
  ) VALUES (
    reseller_row.id, order_row.id, 'order_refund', order_row.total_cost, new_balance,
    COALESCE(NULLIF(_reason, ''), 'Source order failed; reserved balance refunded')
  );

  RETURN QUERY SELECT true, new_balance;
END;
$$;

-- Harden the existing internal-stock reseller order RPC:
-- - database-level rate limit
-- - no flash-sale pricing for reseller API
-- - customer special pricing overrides rather than being ignored by a lower base/tier price
CREATE OR REPLACE FUNCTION public.place_reseller_api_order(
  _api_key_hash text,
  _product_id uuid,
  _quantity integer,
  _external_order_id text DEFAULT NULL::text,
  _unit_price numeric DEFAULT NULL::numeric
)
RETURNS TABLE(
  order_id uuid,
  product_id uuid,
  product_name text,
  quantity integer,
  unit_cost numeric,
  total_cost numeric,
  balance_after numeric,
  details jsonb,
  customer_id uuid,
  customer_chat_id bigint,
  customer_username text,
  customer_first_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  reseller_row public.bot_resellers%ROWTYPE;
  customer_row public.bot_customers%ROWTYPE;
  product_row public.bot_products%ROWTYPE;
  new_reseller_order_id uuid;
  new_customer_order_id uuid;
  picked_details jsonb;
  picked_count integer;
  tier_unit numeric;
  special_unit numeric;
  effective_unit numeric;
  computed_total numeric;
  available_balance numeric;
  new_balance numeric;
  recent_orders integer;
BEGIN
  PERFORM set_config('statement_timeout', '10000', true);
  PERFORM set_config('lock_timeout', '3000', true);

  IF _api_key_hash IS NULL OR length(_api_key_hash) < 32 THEN
    RAISE EXCEPTION 'Invalid API key';
  END IF;

  IF _quantity IS NULL OR _quantity <= 0 OR _quantity > 100 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 100';
  END IF;

  SELECT * INTO reseller_row
  FROM public.bot_resellers
  WHERE api_key_hash = _api_key_hash
  FOR UPDATE;

  IF reseller_row.id IS NULL OR reseller_row.is_active = false THEN
    RAISE EXCEPTION 'Reseller account is not active';
  END IF;

  SELECT COUNT(*)::integer INTO recent_orders
  FROM public.bot_reseller_orders
  WHERE reseller_id = reseller_row.id
    AND created_at >= now() - interval '60 seconds';

  IF recent_orders >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded. Maximum 10 orders per minute.';
  END IF;

  IF reseller_row.customer_id IS NOT NULL THEN
    SELECT * INTO customer_row
    FROM public.bot_customers
    WHERE id = reseller_row.customer_id
    FOR UPDATE;

    IF customer_row.id IS NULL THEN
      RAISE EXCEPTION 'Linked customer account not found';
    END IF;

    IF COALESCE(customer_row.is_banned, false) THEN
      RAISE EXCEPTION 'Linked customer account is banned';
    END IF;

    available_balance := COALESCE(customer_row.balance, 0);
  ELSE
    available_balance := COALESCE(reseller_row.balance, 0);
  END IF;

  IF _external_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bot_reseller_orders
    WHERE reseller_id = reseller_row.id AND external_order_id = _external_order_id
  ) THEN
    RAISE EXCEPTION 'Duplicate external order id';
  END IF;

  SELECT * INTO product_row
  FROM public.bot_products
  WHERE id = _product_id AND is_active = true
  FOR UPDATE;

  IF product_row.id IS NULL THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  IF product_row.is_manual_delivery = true THEN
    RAISE EXCEPTION 'Manual delivery products are not available via reseller API';
  END IF;

  IF product_row.source_id IS NOT NULL AND product_row.source_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'Source-backed products must use source reservation path';
  END IF;

  SELECT pp.price INTO tier_unit
  FROM public.bot_product_pricing pp
  WHERE pp.product_id = product_row.id
    AND pp.min_quantity <= _quantity
    AND (pp.max_quantity IS NULL OR pp.max_quantity >= _quantity)
    AND pp.price > 0
  ORDER BY pp.price ASC, pp.min_quantity DESC
  LIMIT 1;

  IF reseller_row.customer_id IS NOT NULL THEN
    SELECT cp.price INTO special_unit
    FROM public.bot_customer_pricing cp
    WHERE cp.customer_id = reseller_row.customer_id
      AND cp.product_id = product_row.id
      AND cp.is_active = true
      AND cp.min_quantity <= _quantity
      AND cp.price > 0
    ORDER BY cp.min_quantity DESC, cp.price ASC
    LIMIT 1;
  END IF;

  -- Reseller pricing rule: customer-special is an override; otherwise use lowest base/tier.
  -- Flash sales are intentionally excluded from reseller API pricing.
  IF special_unit IS NOT NULL AND special_unit > 0 THEN
    effective_unit := special_unit;
  ELSE
    SELECT MIN(v) INTO effective_unit
    FROM unnest(ARRAY[product_row.price, tier_unit]) AS candidate(v)
    WHERE v IS NOT NULL AND v > 0;
  END IF;

  IF effective_unit IS NULL OR effective_unit <= 0 THEN
    RAISE EXCEPTION 'Product not purchasable';
  END IF;

  computed_total := ROUND(effective_unit * _quantity, 2);

  IF available_balance < computed_total THEN
    RAISE EXCEPTION 'Insufficient reseller balance';
  END IF;

  WITH picked AS (
    SELECT s.id, s.data
    FROM public.bot_product_stock_items s
    WHERE s.product_id = _product_id
      AND s.status = 'available'
      AND s.data <> '{}'::jsonb
      AND EXISTS (
        SELECT 1
        FROM jsonb_each_text(s.data) AS item(key, value)
        WHERE btrim(coalesce(item.value, '')) <> ''
      )
    ORDER BY s.sort_index, s.id
    LIMIT _quantity
    FOR UPDATE SKIP LOCKED
  )
  SELECT COALESCE(jsonb_agg(picked.data), '[]'::jsonb), count(*)::integer
  INTO picked_details, picked_count
  FROM picked;

  IF picked_count < _quantity THEN
    RAISE EXCEPTION 'Not enough deliverable stock available';
  END IF;

  IF reseller_row.customer_id IS NOT NULL THEN
    INSERT INTO public.bot_orders (
      customer_id, product_id, product_name, quantity, total_price, details, row_numbers, status
    ) VALUES (
      reseller_row.customer_id, product_row.id, product_row.name, _quantity, computed_total, picked_details, ARRAY[]::integer[], 'completed'
    ) RETURNING id INTO new_customer_order_id;
  END IF;

  INSERT INTO public.bot_reseller_orders (
    reseller_id, product_id, product_name, quantity, unit_cost, total_cost, external_order_id, status
  ) VALUES (
    reseller_row.id, product_row.id, product_row.name, _quantity, effective_unit, computed_total, _external_order_id, 'processing'
  ) RETURNING id INTO new_reseller_order_id;

  UPDATE public.bot_product_stock_items s
  SET status = 'sold',
      sold_order_id = COALESCE(new_customer_order_id, new_reseller_order_id),
      sold_at = now(),
      updated_at = now()
  WHERE s.id IN (
    SELECT picked.id
    FROM public.bot_product_stock_items picked
    WHERE picked.product_id = _product_id
      AND picked.status = 'available'
      AND picked.data <> '{}'::jsonb
      AND EXISTS (
        SELECT 1
        FROM jsonb_each_text(picked.data) AS item(key, value)
        WHERE btrim(coalesce(item.value, '')) <> ''
      )
    ORDER BY picked.sort_index, picked.id
    LIMIT _quantity
    FOR UPDATE SKIP LOCKED
  );

  GET DIAGNOSTICS picked_count = ROW_COUNT;
  IF picked_count < _quantity THEN
    RAISE EXCEPTION 'Not enough deliverable stock available';
  END IF;

  new_balance := ROUND(available_balance - computed_total, 2);

  IF reseller_row.customer_id IS NOT NULL THEN
    UPDATE public.bot_customers
    SET balance = new_balance,
        updated_at = now()
    WHERE id = reseller_row.customer_id;
  END IF;

  UPDATE public.bot_resellers
  SET balance = new_balance,
      updated_at = now()
  WHERE id = reseller_row.id;

  UPDATE public.bot_reseller_orders
  SET details = picked_details,
      status = 'completed'
  WHERE id = new_reseller_order_id;

  INSERT INTO public.bot_reseller_balance_transactions (
    reseller_id, order_id, type, amount, balance_after, note
  ) VALUES (
    reseller_row.id, new_reseller_order_id, 'order_debit', -computed_total, new_balance, 'Reseller API order'
  );

  RETURN QUERY
  SELECT new_reseller_order_id, product_row.id, product_row.name, _quantity, effective_unit, computed_total, new_balance, picked_details,
         customer_row.id, customer_row.chat_id, customer_row.username, customer_row.first_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_reseller_source_api_order(text, uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_reseller_source_api_order(text, uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reserve_reseller_source_api_order(text, uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_reseller_source_api_order(text, uuid, integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_reseller_source_api_order(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_reseller_source_api_order(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refund_reseller_source_api_order(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_reseller_source_api_order(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.place_reseller_api_order(text, uuid, integer, text, numeric) TO service_role;