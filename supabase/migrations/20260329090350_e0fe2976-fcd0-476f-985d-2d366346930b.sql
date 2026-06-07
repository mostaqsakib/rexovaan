
CREATE OR REPLACE TRIGGER trg_product_short_code
  BEFORE INSERT ON public.bot_products
  FOR EACH ROW
  WHEN (NEW.short_code IS NULL)
  EXECUTE FUNCTION generate_product_short_code();
