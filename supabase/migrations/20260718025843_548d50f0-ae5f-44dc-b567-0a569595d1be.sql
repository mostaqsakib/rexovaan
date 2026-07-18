DROP FUNCTION IF EXISTS public.find_stock_duplicates(uuid, text[]);

CREATE OR REPLACE FUNCTION public.find_stock_duplicates(p_product_id uuid, p_values text[])
 RETURNS TABLE(matched_value text, id uuid, status text, invalid_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH input AS (
    SELECT DISTINCT lower(trim(v)) AS v
    FROM unnest(p_values) AS v
    WHERE v IS NOT NULL AND length(trim(v)) > 0
  ),
  input_arr AS (
    SELECT array_agg(v) AS arr FROM input
  ),
  candidates AS (
    SELECT s.id, s.status, s.invalid_reason, s.data_values_lower
    FROM public.bot_product_stock_items s, input_arr ia
    WHERE s.product_id = p_product_id
      AND s.data_values_lower && ia.arr
  ),
  expanded AS (
    SELECT c.id, c.status, c.invalid_reason, unnest(c.data_values_lower) AS v FROM candidates c
  )
  SELECT DISTINCT ON (i.v) i.v, e.id, e.status, e.invalid_reason
  FROM input i
  JOIN expanded e ON e.v = i.v
  ORDER BY i.v, e.id;
$function$;