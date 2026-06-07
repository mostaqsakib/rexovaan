CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.bot_resellers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0,
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_prefix TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.bot_reseller_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reseller_id UUID NOT NULL REFERENCES public.bot_resellers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.bot_reseller_balance_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reseller_id UUID NOT NULL REFERENCES public.bot_resellers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.bot_reseller_orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bot_reseller_orders_external_unique
ON public.bot_reseller_orders (reseller_id, external_order_id)
WHERE external_order_id IS NOT NULL;

CREATE INDEX idx_bot_reseller_orders_reseller_created
ON public.bot_reseller_orders (reseller_id, created_at DESC);

CREATE INDEX idx_bot_reseller_balance_transactions_reseller_created
ON public.bot_reseller_balance_transactions (reseller_id, created_at DESC);

ALTER TABLE public.bot_resellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_reseller_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_reseller_balance_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_bot_resellers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_bot_resellers_updated_at
BEFORE UPDATE ON public.bot_resellers
FOR EACH ROW
EXECUTE FUNCTION public.update_bot_resellers_updated_at();

CREATE OR REPLACE FUNCTION public.place_reseller_api_order(
  _api_key_hash TEXT,
  _product_id UUID,
  _quantity INTEGER,
  _external_order_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  order_id UUID,
  product_id UUID,
  product_name TEXT,
  quantity INTEGER,
  unit_cost NUMERIC,
  total_cost NUMERIC,
  balance_after NUMERIC,
  details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reseller_row public.bot_resellers%ROWTYPE;
  product_row public.bot_products%ROWTYPE;
  new_order_id UUID;
  picked_details JSONB;
  picked_count INTEGER;
  computed_total NUMERIC;
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

  IF reseller_row.balance < computed_total THEN
    RAISE EXCEPTION 'Insufficient reseller balance';
  END IF;

  INSERT INTO public.bot_reseller_orders (
    reseller_id, product_id, product_name, quantity, unit_cost, total_cost, external_order_id, status
  ) VALUES (
    reseller_row.id, product_row.id, product_row.name, _quantity, product_row.price, computed_total, _external_order_id, 'processing'
  ) RETURNING id INTO new_order_id;

  WITH picked AS (
    SELECT s.id, s.data
    FROM public.bot_product_stock_items s
    WHERE s.product_id = _product_id
      AND s.status = 'available'
    ORDER BY s.created_at, s.id
    LIMIT _quantity
    FOR UPDATE SKIP LOCKED
  ), checked AS (
    SELECT count(*)::integer AS cnt FROM picked
  ), updated AS (
    UPDATE public.bot_product_stock_items s
    SET status = 'sold',
        sold_order_id = new_order_id,
        sold_at = now(),
        updated_at = now()
    FROM picked, checked
    WHERE s.id = picked.id
      AND checked.cnt = _quantity
    RETURNING picked.data
  )
  SELECT COALESCE(jsonb_agg(updated.data), '[]'::jsonb), count(*)::integer
  INTO picked_details, picked_count
  FROM updated;

  IF picked_count < _quantity THEN
    RAISE EXCEPTION 'Not enough stock available';
  END IF;

  new_balance := reseller_row.balance - computed_total;

  UPDATE public.bot_resellers
  SET balance = new_balance
  WHERE id = reseller_row.id;

  UPDATE public.bot_reseller_orders
  SET details = picked_details,
      status = 'completed'
  WHERE id = new_order_id;

  INSERT INTO public.bot_reseller_balance_transactions (
    reseller_id, order_id, type, amount, balance_after, note
  ) VALUES (
    reseller_row.id, new_order_id, 'order_debit', -computed_total, new_balance, 'Reseller API order'
  );

  RETURN QUERY
  SELECT new_order_id, product_row.id, product_row.name, _quantity, product_row.price, computed_total, new_balance, picked_details;
END;
$$;

REVOKE ALL ON FUNCTION public.place_reseller_api_order(TEXT, UUID, INTEGER, TEXT) FROM PUBLIC;