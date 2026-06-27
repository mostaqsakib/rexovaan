DROP INDEX IF EXISTS public.uniq_bot_stock_items_product_fingerprint;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bot_stock_items_product_fingerprint_available
ON public.bot_product_stock_items (product_id, stock_fingerprint)
WHERE status = 'available';