
-- 1. Role infrastructure
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'customer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(auth.uid(), 'admin'::public.app_role) $$;

-- 2. Grant admin role to existing logged-in admin user
INSERT INTO public.user_roles (user_id, role)
VALUES ('d847f29a-d660-49a8-816c-c0ee49835066', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- ===== 3. Lock policies on admin-only tables =====

-- bot_customers
DROP POLICY IF EXISTS "Admin read customers" ON public.bot_customers;
DROP POLICY IF EXISTS "Admin write customers delete" ON public.bot_customers;
DROP POLICY IF EXISTS "Admin write customers insert" ON public.bot_customers;
DROP POLICY IF EXISTS "Admin write customers update" ON public.bot_customers;
CREATE POLICY "Admins manage customers" ON public.bot_customers FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_orders
DROP POLICY IF EXISTS "Admin read orders" ON public.bot_orders;
DROP POLICY IF EXISTS "Admin write orders delete" ON public.bot_orders;
DROP POLICY IF EXISTS "Admin write orders insert" ON public.bot_orders;
DROP POLICY IF EXISTS "Admin write orders update" ON public.bot_orders;
CREATE POLICY "Admins manage orders" ON public.bot_orders FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_deposits
DROP POLICY IF EXISTS "Admin read deposits" ON public.bot_deposits;
DROP POLICY IF EXISTS "Admin write deposits delete" ON public.bot_deposits;
DROP POLICY IF EXISTS "Admin write deposits update" ON public.bot_deposits;
CREATE POLICY "Admins manage deposits" ON public.bot_deposits FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_withdrawals
DROP POLICY IF EXISTS "Admin read withdrawals" ON public.bot_withdrawals;
DROP POLICY IF EXISTS "Admin write withdrawals delete" ON public.bot_withdrawals;
DROP POLICY IF EXISTS "Admin write withdrawals update" ON public.bot_withdrawals;
CREATE POLICY "Admins manage withdrawals" ON public.bot_withdrawals FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_referrals
DROP POLICY IF EXISTS "Admin read referrals" ON public.bot_referrals;
DROP POLICY IF EXISTS "Admin write referrals delete" ON public.bot_referrals;
DROP POLICY IF EXISTS "Admin write referrals insert" ON public.bot_referrals;
DROP POLICY IF EXISTS "Admin write referrals update" ON public.bot_referrals;
CREATE POLICY "Admins manage referrals" ON public.bot_referrals FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_referral_earnings
DROP POLICY IF EXISTS "Admin read referral earnings" ON public.bot_referral_earnings;
DROP POLICY IF EXISTS "Admin write referral earnings delete" ON public.bot_referral_earnings;
DROP POLICY IF EXISTS "Admin write referral earnings insert" ON public.bot_referral_earnings;
DROP POLICY IF EXISTS "Admin write referral earnings update" ON public.bot_referral_earnings;
CREATE POLICY "Admins manage referral earnings" ON public.bot_referral_earnings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_balance_adjustments (admin only — sensitive)
DROP POLICY IF EXISTS "Admin full access balance adjustments" ON public.bot_balance_adjustments;
CREATE POLICY "Admins manage balance adjustments" ON public.bot_balance_adjustments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_product_sources (contains API keys)
DROP POLICY IF EXISTS "Admin full access product sources" ON public.bot_product_sources;
CREATE POLICY "Admins manage product sources" ON public.bot_product_sources FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_product_stock_items (contains sold license codes)
DROP POLICY IF EXISTS "Admin full access stock items" ON public.bot_product_stock_items;
CREATE POLICY "Admins manage stock items" ON public.bot_product_stock_items FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_resellers
DROP POLICY IF EXISTS "Admin full access resellers" ON public.bot_resellers;
CREATE POLICY "Admins manage resellers" ON public.bot_resellers FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_reseller_orders
DROP POLICY IF EXISTS "Admin full access reseller orders" ON public.bot_reseller_orders;
CREATE POLICY "Admins manage reseller orders" ON public.bot_reseller_orders FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_reseller_balance_transactions
DROP POLICY IF EXISTS "Admin full access reseller balance txns" ON public.bot_reseller_balance_transactions;
CREATE POLICY "Admins manage reseller balance txns" ON public.bot_reseller_balance_transactions FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_broadcast_groups
DROP POLICY IF EXISTS "Service role full access" ON public.bot_broadcast_groups;
CREATE POLICY "Admins manage broadcast groups" ON public.bot_broadcast_groups FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_button_emojis
DROP POLICY IF EXISTS "Service role full access" ON public.bot_button_emojis;
CREATE POLICY "Public read button emojis" ON public.bot_button_emojis FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage button emojis" ON public.bot_button_emojis FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_keyword_triggers
DROP POLICY IF EXISTS "Service role full access" ON public.bot_keyword_triggers;
CREATE POLICY "Admins manage keyword triggers" ON public.bot_keyword_triggers FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- telegram_bot_state
DROP POLICY IF EXISTS "Service role full access" ON public.telegram_bot_state;
-- No client policies — service role bypasses RLS anyway

-- ===== 4. Tables with public read but admin write =====

-- bot_products: public read active stays; lock writes to admin
DROP POLICY IF EXISTS "Service role full access" ON public.bot_products;
CREATE POLICY "Admins write products" ON public.bot_products FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update products" ON public.bot_products FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete products" ON public.bot_products FOR DELETE TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins read all products" ON public.bot_products FOR SELECT TO authenticated
  USING (public.is_admin());

-- bot_payment_methods
DROP POLICY IF EXISTS "Service role full access" ON public.bot_payment_methods;
CREATE POLICY "Admins write payment methods" ON public.bot_payment_methods FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update payment methods" ON public.bot_payment_methods FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete payment methods" ON public.bot_payment_methods FOR DELETE TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins read all payment methods" ON public.bot_payment_methods FOR SELECT TO authenticated
  USING (public.is_admin());

-- bot_flash_sales
DROP POLICY IF EXISTS "Service role full access flash sales" ON public.bot_flash_sales;
CREATE POLICY "Admins write flash sales" ON public.bot_flash_sales FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update flash sales" ON public.bot_flash_sales FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete flash sales" ON public.bot_flash_sales FOR DELETE TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins read all flash sales" ON public.bot_flash_sales FOR SELECT TO authenticated
  USING (public.is_admin());

-- bot_product_pricing
DROP POLICY IF EXISTS "Service role full access" ON public.bot_product_pricing;
CREATE POLICY "Admins manage product pricing" ON public.bot_product_pricing FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_customer_pricing (customers can read own already)
DROP POLICY IF EXISTS "Service role full access customer pricing" ON public.bot_customer_pricing;
CREATE POLICY "Admins manage customer pricing" ON public.bot_customer_pricing FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- site_announcements
DROP POLICY IF EXISTS "Service role full access announcements" ON public.site_announcements;
CREATE POLICY "Admins manage announcements" ON public.site_announcements FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_custom_emoji_cache
DROP POLICY IF EXISTS "Service role full access custom emoji cache" ON public.bot_custom_emoji_cache;
CREATE POLICY "Admins manage custom emoji cache" ON public.bot_custom_emoji_cache FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- bot_settings: public read for branding stays; admin manages everything
DROP POLICY IF EXISTS "Admin read all settings" ON public.bot_settings;
DROP POLICY IF EXISTS "Admin write settings delete" ON public.bot_settings;
DROP POLICY IF EXISTS "Admin write settings insert" ON public.bot_settings;
DROP POLICY IF EXISTS "Admin write settings update" ON public.bot_settings;
CREATE POLICY "Admins manage settings" ON public.bot_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ===== 5. Storage: custom-emojis bucket — only admins can upload/modify =====
DROP POLICY IF EXISTS "Public upload to custom-emojis" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload custom emojis" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update custom emojis" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete custom emojis" ON storage.objects;

CREATE POLICY "Admins upload custom emojis" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'custom-emojis' AND public.is_admin());
CREATE POLICY "Admins update custom emojis" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'custom-emojis' AND public.is_admin());
CREATE POLICY "Admins delete custom emojis" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'custom-emojis' AND public.is_admin());
