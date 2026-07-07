DROP POLICY IF EXISTS "Public read tiered pricing" ON public.bot_product_pricing;
CREATE POLICY "Public read tiered pricing for active products"
ON public.bot_product_pricing
FOR SELECT
TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.bot_products p WHERE p.id = bot_product_pricing.product_id AND p.is_active = true));