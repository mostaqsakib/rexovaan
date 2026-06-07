CREATE OR REPLACE FUNCTION public.get_product_stock_counts(_product_ids uuid[])
RETURNS TABLE(product_id uuid, available_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.product_id, COUNT(*)::bigint AS available_count
  FROM public.bot_product_stock_items s
  WHERE s.product_id = ANY(_product_ids)
    AND s.status = 'available'
  GROUP BY s.product_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_stock_counts(uuid[]) TO anon, authenticated;