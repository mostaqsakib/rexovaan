-- ============================================================
-- 1. Checkout audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.checkout_audit_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid,
  customer_id         uuid NOT NULL,
  product_id          uuid NOT NULL,
  quantity            integer NOT NULL,
  unit_price          numeric NOT NULL,
  total_price         numeric NOT NULL,
  idempotency_key     text NOT NULL,
  reserved_count      integer NOT NULL,
  was_idempotent_hit  boolean NOT NULL DEFAULT false,
  outcome             text NOT NULL DEFAULT 'completed',
  created_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.checkout_audit_logs TO authenticated;
GRANT ALL ON public.checkout_audit_logs TO service_role;

ALTER TABLE public.checkout_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all checkout audit logs"
ON public.checkout_audit_logs FOR SELECT TO authenticated
USING (public.is_admin());

CREATE POLICY "Service role full access on checkout audit logs"
ON public.checkout_audit_logs FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS checkout_audit_logs_customer_idx ON public.checkout_audit_logs(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_audit_logs_order_idx ON public.checkout_audit_logs(order_id);
CREATE INDEX IF NOT EXISTS checkout_audit_logs_idem_idx ON public.checkout_audit_logs(idempotency_key);

-- ============================================================
-- 2. Wallet ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid NOT NULL,
  amount               numeric NOT NULL,
  type                 text NOT NULL,
  reference_order_id   uuid,
  reference_table      text,
  reference_id         uuid,
  balance_before       numeric NOT NULL,
  balance_after        numeric NOT NULL,
  idempotency_key      text,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.wallet_ledger TO authenticated;
GRANT ALL ON public.wallet_ledger TO service_role;

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read their own ledger"
ON public.wallet_ledger FOR SELECT TO authenticated
USING (customer_id = public.current_customer_id() OR public.is_admin());

CREATE POLICY "Service role full access on wallet ledger"
ON public.wallet_ledger FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS wallet_ledger_customer_idx ON public.wallet_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_order_idx ON public.wallet_ledger(reference_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_customer_idem_uniq
  ON public.wallet_ledger(customer_id, idempotency_key, type)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 3. Feature flag (default OFF for shadow rollout)
-- ============================================================
INSERT INTO public.bot_settings (key, value)
VALUES ('use_atomic_checkout', 'false')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. Updated atomic checkout RPC with audit log + wallet ledger
-- ============================================================
CREATE OR REPLACE FUNCTION public.checkout_balance_atomic(
  _customer_id      uuid,
  _product_id       uuid,
  _quantity         integer,
  _expected_unit    numeric,
  _idempotency_key  text
)
RETURNS TABLE(order_id uuid, total_price numeric, unit_price numeric, details jsonb, new_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer   public.bot_customers%ROWTYPE;
  v_product    public.bot_products%ROWTYPE;
  v_unit       numeric;
  v_total      numeric;
  v_order_id   uuid;
  v_details    jsonb;
  v_picked     integer;
  v_existing   public.bot_orders%ROWTYPE;
  v_balance_before numeric;
  v_balance_after  numeric;
BEGIN
  IF _quantity IS NULL OR _quantity < 1 OR _quantity > 500 THEN
    RAISE EXCEPTION 'Invalid quantity';
  END IF;
  IF _idempotency_key IS NULL OR length(btrim(_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'Missing idempotency key';
  END IF;

  -- Idempotency short-circuit
  SELECT * INTO v_existing FROM public.bot_orders
  WHERE customer_id = _customer_id AND idempotency_key = _idempotency_key LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    -- Log the replay attempt
    INSERT INTO public.checkout_audit_logs(
      order_id, customer_id, product_id, quantity, unit_price, total_price,
      idempotency_key, reserved_count, was_idempotent_hit, outcome
    ) VALUES (
      v_existing.id, _customer_id, _product_id, v_existing.quantity,
      ROUND(v_existing.total_price / NULLIF(v_existing.quantity, 0), 4),
      v_existing.total_price, _idempotency_key,
      COALESCE(jsonb_array_length(v_existing.details), 0),
      true, 'replay'
    );
    RETURN QUERY
      SELECT v_existing.id,
             v_existing.total_price,
             ROUND(v_existing.total_price / NULLIF(v_existing.quantity, 0), 4),
             v_existing.details,
             (SELECT balance FROM public.bot_customers WHERE id = _customer_id);
    RETURN;
  END IF;

  -- Lock customer
  SELECT * INTO v_customer FROM public.bot_customers WHERE id = _customer_id FOR UPDATE;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF COALESCE(v_customer.is_banned, false) THEN RAISE EXCEPTION 'Account banned'; END IF;
  v_balance_before := COALESCE(v_customer.balance, 0);

  -- Lock product
  SELECT * INTO v_product FROM public.bot_products WHERE id = _product_id FOR UPDATE;
  IF v_product.id IS NULL OR v_product.is_active = false THEN RAISE EXCEPTION 'Product not available'; END IF;
  IF v_product.is_manual_delivery = true THEN RAISE EXCEPTION 'Manual delivery only'; END IF;

  -- Authoritative price
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

  -- Create order
  INSERT INTO public.bot_orders (
    customer_id, product_id, product_name, quantity,
    total_price, payment_method, status, details, row_numbers,
    source, idempotency_key
  ) VALUES (
    _customer_id, _product_id, v_product.name, _quantity,
    v_total, 'balance', 'completed', '[]'::jsonb, ARRAY[]::integer[],
    'web', _idempotency_key
  ) RETURNING id INTO v_order_id;

  -- Reserve stock
  WITH picked AS (
    SELECT s.id, s.data FROM public.bot_product_stock_items s
    WHERE s.product_id = _product_id AND s.status = 'available'
    ORDER BY s.sort_index, s.id LIMIT _quantity FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.bot_product_stock_items s
    SET status = 'sold', sold_order_id = v_order_id, sold_at = now(), updated_at = now()
    FROM picked WHERE s.id = picked.id
    RETURNING s.data
  )
  SELECT COALESCE(jsonb_agg(data), '[]'::jsonb), count(*)::int
  INTO v_details, v_picked FROM upd;

  IF v_picked < _quantity THEN RAISE EXCEPTION 'Not enough stock'; END IF;

  -- Debit balance
  v_balance_after := v_balance_before - v_total;
  UPDATE public.bot_customers
  SET balance = v_balance_after, updated_at = now()
  WHERE id = _customer_id;

  -- Wallet ledger entry (same txn)
  INSERT INTO public.wallet_ledger(
    customer_id, amount, type, reference_order_id, reference_table, reference_id,
    balance_before, balance_after, idempotency_key, note
  ) VALUES (
    _customer_id, -v_total, 'purchase', v_order_id, 'bot_orders', v_order_id,
    v_balance_before, v_balance_after, _idempotency_key,
    'Web checkout: ' || v_product.name || ' x' || _quantity
  );

  -- Finalize order
  UPDATE public.bot_orders
  SET details = v_details, delivered_at = now()
  WHERE id = v_order_id;

  -- Audit log (same txn)
  INSERT INTO public.checkout_audit_logs(
    order_id, customer_id, product_id, quantity, unit_price, total_price,
    idempotency_key, reserved_count, was_idempotent_hit, outcome
  ) VALUES (
    v_order_id, _customer_id, _product_id, _quantity, v_unit, v_total,
    _idempotency_key, v_picked, false, 'completed'
  );

  RETURN QUERY SELECT v_order_id, v_total, v_unit, v_details, v_balance_after;
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_balance_atomic(uuid, uuid, integer, numeric, text) TO authenticated, service_role;