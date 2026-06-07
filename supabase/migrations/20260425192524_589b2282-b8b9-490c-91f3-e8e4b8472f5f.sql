ALTER TABLE public.bot_products
ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'google_sheet';

CREATE TABLE IF NOT EXISTS public.bot_product_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'available',
  sold_order_id uuid,
  sold_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_product_stock_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.bot_product_stock_items;
CREATE POLICY "Service role full access"
ON public.bot_product_stock_items
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_bot_stock_items_product_status
ON public.bot_product_stock_items (product_id, status, created_at);

CREATE OR REPLACE FUNCTION public.reserve_internal_stock_items(
  _product_id uuid,
  _quantity integer,
  _order_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, data jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT s.id
    FROM public.bot_product_stock_items s
    WHERE s.product_id = _product_id
      AND s.status = 'available'
    ORDER BY s.created_at, s.id
    LIMIT _quantity
    FOR UPDATE SKIP LOCKED
  ), checked AS (
    SELECT COUNT(*)::integer AS picked_count FROM picked
  ), updated AS (
    UPDATE public.bot_product_stock_items s
    SET status = 'sold',
        sold_order_id = _order_id,
        sold_at = now(),
        updated_at = now()
    FROM picked
    WHERE s.id = picked.id
      AND (SELECT picked_count FROM checked) = _quantity
    RETURNING s.id, s.data
  )
  SELECT updated.id, updated.data FROM updated;

  IF (SELECT COUNT(*) FROM public.bot_product_stock_items s WHERE s.product_id = _product_id AND s.status = 'sold' AND s.sold_order_id IS NOT DISTINCT FROM _order_id AND s.sold_at > now() - interval '5 seconds') < _quantity THEN
    RAISE EXCEPTION 'Not enough stock available';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_internal_stock_items(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bot_product_stock_items
  SET status = 'available',
      sold_order_id = NULL,
      sold_at = NULL,
      updated_at = now()
  WHERE sold_order_id = _order_id;
END;
$$;