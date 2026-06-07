-- Restore permissive admin access on tables used exclusively by the admin panel
CREATE POLICY "Admin full access stock items" ON public.bot_product_stock_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access product sources" ON public.bot_product_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access balance adjustments" ON public.bot_balance_adjustments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access resellers" ON public.bot_resellers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access reseller orders" ON public.bot_reseller_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin full access reseller balance txns" ON public.bot_reseller_balance_transactions FOR ALL USING (true) WITH CHECK (true);

-- Settings: keep public SELECT for branding keys, allow admin writes
CREATE POLICY "Admin write settings insert" ON public.bot_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin write settings update" ON public.bot_settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write settings delete" ON public.bot_settings FOR DELETE USING (true);
CREATE POLICY "Admin read all settings" ON public.bot_settings FOR SELECT USING (true);

-- Customer-scoped tables: keep their SELECT policies, restore write access for admin
CREATE POLICY "Admin write customers update" ON public.bot_customers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write customers insert" ON public.bot_customers FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin write customers delete" ON public.bot_customers FOR DELETE USING (true);

CREATE POLICY "Admin write deposits update" ON public.bot_deposits FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write deposits delete" ON public.bot_deposits FOR DELETE USING (true);

CREATE POLICY "Admin write withdrawals update" ON public.bot_withdrawals FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write withdrawals delete" ON public.bot_withdrawals FOR DELETE USING (true);

CREATE POLICY "Admin write orders insert" ON public.bot_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin write orders update" ON public.bot_orders FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write orders delete" ON public.bot_orders FOR DELETE USING (true);

CREATE POLICY "Admin write referrals insert" ON public.bot_referrals FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin write referrals update" ON public.bot_referrals FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write referrals delete" ON public.bot_referrals FOR DELETE USING (true);

CREATE POLICY "Admin write referral earnings insert" ON public.bot_referral_earnings FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin write referral earnings update" ON public.bot_referral_earnings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin write referral earnings delete" ON public.bot_referral_earnings FOR DELETE USING (true);