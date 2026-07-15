
DROP POLICY IF EXISTS "Admins manage evm chain state" ON public.evm_chain_state;
CREATE POLICY "Admins manage evm chain state" ON public.evm_chain_state
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins view gas alerts" ON public.evm_gas_alerts;
CREATE POLICY "Admins view gas alerts" ON public.evm_gas_alerts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage TON reservations" ON public.ton_reserved_deposits;
CREATE POLICY "Admins manage TON reservations" ON public.ton_reserved_deposits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "admin all google_account_cookies" ON public.google_account_cookies;
CREATE POLICY "admin all google_account_cookies" ON public.google_account_cookies
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
