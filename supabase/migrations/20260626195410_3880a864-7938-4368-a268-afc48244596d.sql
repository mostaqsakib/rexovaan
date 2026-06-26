
-- Create safe public views and remove anon access to internal columns

CREATE OR REPLACE VIEW public.bot_products_public
WITH (security_invoker = false) AS
SELECT
  id, name, description, price, currency, is_active, sort_order,
  short_code, custom_emoji_id, last_known_stock, is_manual_delivery,
  customer_input_fields, delivery_instruction, delivery_media, created_at
FROM public.bot_products
WHERE is_active = true;

GRANT SELECT ON public.bot_products_public TO anon, authenticated;

CREATE OR REPLACE VIEW public.bot_flash_sales_public
WITH (security_invoker = false) AS
SELECT
  id, product_id, sale_price, starts_at, ends_at, is_active, created_at, updated_at
FROM public.bot_flash_sales
WHERE is_active = true;

GRANT SELECT ON public.bot_flash_sales_public TO anon, authenticated;

-- Remove anon/authenticated read on base tables (admins still covered by is_admin() policies)
DROP POLICY IF EXISTS "Public read active products" ON public.bot_products;
DROP POLICY IF EXISTS "Public read flash sales" ON public.bot_flash_sales;
