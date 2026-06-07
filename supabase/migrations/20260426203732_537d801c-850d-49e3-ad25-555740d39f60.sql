DROP FUNCTION IF EXISTS public.place_reseller_api_order(text, uuid, integer, text);

CREATE FUNCTION public.place_reseller_api_order(_api_key_hash text, _product_id uuid, _quantity integer, _external_order_id text DEFAULT NULL::text)
RETURNS TABLE(order_id uuid, product_id uuid, product_name text, quantity integer, unit_cost numeric, total_cost numeric, balance_after numeric, details jsonb, customer_id uuid, customer_chat_id bigint, customer_username text, customer_first_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  reseller_row public.bot_resellers%ROWTYPE;
  customer_row public.bot_customers%ROWTYPE;
  product_row public.bot_products%ROWTYPE;
  new_reseller_order_id UUID;
  new_customer_order_id UUID;
  picked_details JSONB;
  picked_count INTEGER;
  computed_total NUMERIC;
  available_balance NUMERIC;
  new_balance NUMERIC;
BEGIN
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

  IF reseller_row.customer_id IS NOT NULL THEN
    SELECT * INTO customer_row
    FROM public.bot_customers
    WHERE id = reseller_row.customer_id
    FOR UPDATE;

    IF customer_row.id IS NULL THEN
      RAISE EXCEPTION 'Linked customer account not found';
    END IF;

    available_balance := customer_row.balance;
  ELSE
    available_balance := reseller_row.balance;
  END IF;

  IF _external_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bot_reseller_orders
    WHERE reseller_id = reseller_row.id AND external_order_id = _external_order_id
  ) THEN
    RAISE EXCEPTION 'Duplicate external order id';
  END IF;

  SELECT * INTO product_row
  FROM public.bot_products
  WHERE id = _product_id AND is_active = true;

  IF product_row.id IS NULL THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  IF product_row.is_manual_delivery = true THEN
    RAISE EXCEPTION 'Manual delivery products are not available via reseller API';
  END IF;

  computed_total := product_row.price * _quantity;

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
    ORDER BY s.created_at, s.id
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
    reseller_row.id, product_row.id, product_row.name, _quantity, product_row.price, computed_total, _external_order_id, 'processing'
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
    ORDER BY picked.created_at, picked.id
    LIMIT _quantity
    FOR UPDATE SKIP LOCKED
  );

  GET DIAGNOSTICS picked_count = ROW_COUNT;

  IF picked_count < _quantity THEN
    RAISE EXCEPTION 'Not enough deliverable stock available';
  END IF;

  new_balance := available_balance - computed_total;

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
  SELECT new_reseller_order_id, product_row.id, product_row.name, _quantity, product_row.price, computed_total, new_balance, picked_details,
         customer_row.id, customer_row.chat_id, customer_row.username, customer_row.first_name;
END;
$function$;