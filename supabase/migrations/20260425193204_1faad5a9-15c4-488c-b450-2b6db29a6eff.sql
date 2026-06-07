ALTER TABLE public.bot_product_stock_items
ADD COLUMN IF NOT EXISTS stock_fingerprint text;

UPDATE public.bot_product_stock_items
SET stock_fingerprint = md5(data::text)
WHERE stock_fingerprint IS NULL;

CREATE OR REPLACE FUNCTION public.set_stock_item_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.stock_fingerprint := md5(COALESCE(NEW.data, '{}'::jsonb)::text);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_bot_stock_item_fingerprint ON public.bot_product_stock_items;
CREATE TRIGGER set_bot_stock_item_fingerprint
BEFORE INSERT OR UPDATE OF data ON public.bot_product_stock_items
FOR EACH ROW
EXECUTE FUNCTION public.set_stock_item_fingerprint();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bot_stock_items_product_fingerprint
ON public.bot_product_stock_items (product_id, stock_fingerprint);