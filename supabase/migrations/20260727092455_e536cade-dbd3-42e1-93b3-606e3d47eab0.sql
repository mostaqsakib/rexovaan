CREATE INDEX IF NOT EXISTS idx_link_check_items_stock_item_id
ON public.link_check_items (stock_item_id)
WHERE stock_item_id IS NOT NULL;