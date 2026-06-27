CREATE OR REPLACE FUNCTION public.find_stock_duplicates(p_product_id uuid, p_values text[])
RETURNS TABLE(matched_value text, id uuid, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT DISTINCT lower(trim(v)) AS v FROM unnest(p_values) AS v WHERE v IS NOT NULL AND length(trim(v)) > 0
  ),
  expanded AS (
    SELECT s.id, s.status, lower(trim(je.value)) AS v
    FROM public.bot_product_stock_items s
    CROSS JOIN LATERAL jsonb_each_text(s.data) AS je
    WHERE s.product_id = p_product_id
  )
  SELECT DISTINCT ON (i.v) i.v, e.id, e.status
  FROM input i
  JOIN expanded e ON e.v = i.v
  ORDER BY i.v, e.id;
$$;

REVOKE ALL ON FUNCTION public.find_stock_duplicates(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_stock_duplicates(uuid, text[]) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_bot_product_stock_items_product_id ON public.bot_product_stock_items(product_id);