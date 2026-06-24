DROP POLICY IF EXISTS "Public read payment methods" ON public.bot_payment_methods;
CREATE POLICY "Authenticated read payment methods" ON public.bot_payment_methods FOR SELECT TO authenticated USING (is_active = true);
REVOKE SELECT ON public.bot_payment_methods FROM anon;