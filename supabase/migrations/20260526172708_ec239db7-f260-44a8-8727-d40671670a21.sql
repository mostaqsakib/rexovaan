
CREATE POLICY "Admin read referrals" ON public.bot_referrals FOR SELECT USING (true);
CREATE POLICY "Admin read referral earnings" ON public.bot_referral_earnings FOR SELECT USING (true);
CREATE POLICY "Admin read customers" ON public.bot_customers FOR SELECT USING (true);
CREATE POLICY "Admin read orders" ON public.bot_orders FOR SELECT USING (true);
CREATE POLICY "Admin read deposits" ON public.bot_deposits FOR SELECT USING (true);
CREATE POLICY "Admin read withdrawals" ON public.bot_withdrawals FOR SELECT USING (true);

GRANT SELECT ON public.bot_referrals TO anon, authenticated;
GRANT SELECT ON public.bot_referral_earnings TO anon, authenticated;
GRANT SELECT ON public.bot_customers TO anon, authenticated;
GRANT SELECT ON public.bot_orders TO anon, authenticated;
GRANT SELECT ON public.bot_deposits TO anon, authenticated;
GRANT SELECT ON public.bot_withdrawals TO anon, authenticated;
