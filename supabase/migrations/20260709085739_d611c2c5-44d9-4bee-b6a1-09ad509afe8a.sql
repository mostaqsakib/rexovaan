
-- Explicit restrictive RLS documentation: these tables are service_role only. Deny anon/authenticated.
CREATE POLICY "Deny anon/authenticated all access" ON public.admin_action_log AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "Block direct writes by clients" ON public.admin_action_log FOR INSERT TO anon, authenticated WITH CHECK (false);

CREATE POLICY "Service role only - block clients select" ON public.bot_bind_attempts FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "Service role only - block clients modify" ON public.bot_bind_attempts FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Service role only - block clients select" ON public.bot_telegram_bind_codes FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "Service role only - block clients modify" ON public.bot_telegram_bind_codes FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "Service role only - block clients select" ON public.telegram_bot_state FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "Service role only - block clients modify" ON public.telegram_bot_state FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- user_channel_verification: allow user to view their own row via bot_customers linkage
CREATE POLICY "Users can view own channel verification" ON public.user_channel_verification
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bot_customers bc WHERE bc.auth_user_id = auth.uid() AND bc.chat_id = user_channel_verification.user_id));
