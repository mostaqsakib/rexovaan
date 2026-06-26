WITH recent_file_stock AS (
  SELECT
    p.id,
    COUNT(s.id) FILTER (WHERE s.status = 'available')::integer AS available_stock,
    COUNT(s.id) FILTER (
      WHERE s.status = 'available'
        AND s.data ? '_file_path'
        AND s.created_at > now() - interval '2 hours'
    )::integer AS recent_file_added
  FROM public.bot_products p
  JOIN public.bot_product_stock_items s ON s.product_id = p.id
  WHERE s.data ? '_file_path'
    AND s.created_at > now() - interval '2 hours'
  GROUP BY p.id
)
UPDATE public.bot_products p
SET last_known_stock = GREATEST(0, r.available_stock - r.recent_file_added)
FROM recent_file_stock r
WHERE p.id = r.id
  AND r.recent_file_added > 0
  AND COALESCE(p.last_known_stock, 0) >= r.available_stock;