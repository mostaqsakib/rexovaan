
-- Speed up find_stock_duplicates by pre-materializing lowercased jsonb values
-- into an indexed array column, then rewriting the RPC to filter via GIN.

ALTER TABLE public.bot_product_stock_items
  ADD COLUMN IF NOT EXISTS data_values_lower text[];

CREATE OR REPLACE FUNCTION public.set_stock_item_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.stock_fingerprint := md5(COALESCE(NEW.data, '{}'::jsonb)::text);
  NEW.updated_at := now();
  NEW.data_values_lower := ARRAY(
    SELECT lower(trim(je.value))
    FROM jsonb_each_text(COALESCE(NEW.data, '{}'::jsonb)) je
    WHERE je.value IS NOT NULL AND length(trim(je.value)) > 0
  );
  RETURN NEW;
END;
$$;

-- Backfill in batches to avoid statement timeout
DO $$
DECLARE
  batch_ids uuid[];
BEGIN
  LOOP
    SELECT array_agg(id) INTO batch_ids FROM (
      SELECT id FROM public.bot_product_stock_items
      WHERE data_values_lower IS NULL LIMIT 5000
    ) t;
    EXIT WHEN batch_ids IS NULL OR array_length(batch_ids,1) IS NULL;
    UPDATE public.bot_product_stock_items s
    SET data_values_lower = ARRAY(
      SELECT lower(trim(je.value))
      FROM jsonb_each_text(COALESCE(s.data,'{}'::jsonb)) je
      WHERE je.value IS NOT NULL AND length(trim(je.value)) > 0
    )
    WHERE s.id = ANY(batch_ids);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_items_values_gin
  ON public.bot_product_stock_items USING GIN (data_values_lower);

CREATE OR REPLACE FUNCTION public.find_stock_duplicates(p_product_id uuid, p_values text[])
RETURNS TABLE(matched_value text, id uuid, status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH input AS (
    SELECT DISTINCT lower(trim(v)) AS v
    FROM unnest(p_values) AS v
    WHERE v IS NOT NULL AND length(trim(v)) > 0
  ),
  input_arr AS (
    SELECT array_agg(v) AS arr FROM input
  ),
  candidates AS (
    SELECT s.id, s.status, s.data_values_lower
    FROM public.bot_product_stock_items s, input_arr ia
    WHERE s.product_id = p_product_id
      AND s.data_values_lower && ia.arr
  ),
  expanded AS (
    SELECT c.id, c.status, unnest(c.data_values_lower) AS v FROM candidates c
  )
  SELECT DISTINCT ON (i.v) i.v, e.id, e.status
  FROM input i
  JOIN expanded e ON e.v = i.v
  ORDER BY i.v, e.id;
$$;
