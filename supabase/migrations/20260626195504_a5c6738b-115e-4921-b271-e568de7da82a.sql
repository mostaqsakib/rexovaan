
-- Drop the helper views; we'll lock down with column-level grants instead (cleaner, no SECURITY DEFINER view warnings).
DROP VIEW IF EXISTS public.bot_products_public;
DROP VIEW IF EXISTS public.bot_flash_sales_public;

-- Re-create public read policies (only filter, anon column visibility is controlled by GRANTs below).
CREATE POLICY "Public read active products" ON public.bot_products
  FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public read flash sales" ON public.bot_flash_sales
  FOR SELECT TO anon, authenticated USING (is_active = true);

-- ===== bot_products: anon can ONLY see safe storefront columns =====
REVOKE SELECT ON public.bot_products FROM anon;
GRANT SELECT (
  id, name, description, price, currency, is_active, sort_order,
  short_code, custom_emoji_id, last_known_stock, is_manual_delivery,
  customer_input_fields, created_at
) ON public.bot_products TO anon;

-- ===== bot_flash_sales: anon cannot see announcement_messages / target_group_ids =====
REVOKE SELECT ON public.bot_flash_sales FROM anon;
GRANT SELECT (
  id, product_id, sale_price, starts_at, ends_at, is_active, created_at, updated_at
) ON public.bot_flash_sales TO anon;
