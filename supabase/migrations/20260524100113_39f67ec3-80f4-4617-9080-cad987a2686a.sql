-- 1. Link column
ALTER TABLE public.bot_customers
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;

CREATE INDEX IF NOT EXISTS idx_bot_customers_auth_user_id ON public.bot_customers(auth_user_id);

-- 2. Helper: current customer id from auth.uid()
CREATE OR REPLACE FUNCTION public.current_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.bot_customers WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- 3. Customer self-access on bot_customers
CREATE POLICY "Customers view own row"
  ON public.bot_customers FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Customers update own row limited"
  ON public.bot_customers FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- 4. Orders: read own only
CREATE POLICY "Customers view own orders"
  ON public.bot_orders FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id());

-- 5. Deposits: read + insert own
CREATE POLICY "Customers view own deposits"
  ON public.bot_deposits FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id());

CREATE POLICY "Customers insert own deposits"
  ON public.bot_deposits FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = public.current_customer_id());

-- 6. Withdrawals: read + insert own
CREATE POLICY "Customers view own withdrawals"
  ON public.bot_withdrawals FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id());

CREATE POLICY "Customers insert own withdrawals"
  ON public.bot_withdrawals FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = public.current_customer_id());

-- 7. Notification settings: full own access
CREATE POLICY "Customers manage own notif settings select"
  ON public.bot_notification_settings FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id());

CREATE POLICY "Customers manage own notif settings update"
  ON public.bot_notification_settings FOR UPDATE
  TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "Customers manage own notif settings insert"
  ON public.bot_notification_settings FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = public.current_customer_id());

-- 8. Public catalog reads (products, pricing, flash sales, payment methods)
CREATE POLICY "Public read active products"
  ON public.bot_products FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Public read tiered pricing"
  ON public.bot_product_pricing FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public read flash sales"
  ON public.bot_flash_sales FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "Public read payment methods"
  ON public.bot_payment_methods FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- 9. Authenticated customers see their own special pricing
CREATE POLICY "Customers view own special pricing"
  ON public.bot_customer_pricing FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id() AND is_active = true);

-- 10. Referrals read-only own
CREATE POLICY "Customers view own referral earnings"
  ON public.bot_referral_earnings FOR SELECT
  TO authenticated
  USING (referrer_id = public.current_customer_id());

CREATE POLICY "Customers view own referrals as referrer"
  ON public.bot_referrals FOR SELECT
  TO authenticated
  USING (referrer_id = public.current_customer_id() OR referred_id = public.current_customer_id());
