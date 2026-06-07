CREATE OR REPLACE FUNCTION public.get_product_stock_items(_product_id uuid)
RETURNS TABLE(id uuid, data jsonb, status text, created_at timestamptz, sold_at timestamptz, sort_index bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.data, s.status, s.created_at, s.sold_at, s.sort_index
  FROM public.bot_product_stock_items s
  WHERE s.product_id = _product_id
  ORDER BY s.sort_index ASC, s.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_stock_items(uuid) TO anon, authenticated;