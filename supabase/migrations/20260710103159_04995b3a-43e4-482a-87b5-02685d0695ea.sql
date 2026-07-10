
-- Fix 1: restrict fake transactions SELECT to authenticated role
DROP POLICY IF EXISTS "Admins can view fake transactions" ON public.bep20_fake_transactions;
CREATE POLICY "Admins can view fake transactions"
  ON public.bep20_fake_transactions
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix 2: restrict bot_button_emojis + bot_custom_emoji_cache public read to authenticated only
DROP POLICY IF EXISTS "Public read button emojis" ON public.bot_button_emojis;
CREATE POLICY "Authenticated read button emojis"
  ON public.bot_button_emojis
  FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.bot_button_emojis FROM anon;

DROP POLICY IF EXISTS "Public read custom emoji cache" ON public.bot_custom_emoji_cache;
CREATE POLICY "Authenticated read custom emoji cache"
  ON public.bot_custom_emoji_cache
  FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.bot_custom_emoji_cache FROM anon;

-- Fix 3: add explicit admin write policy for user_channel_verification
CREATE POLICY "Admins manage channel verification"
  ON public.user_channel_verification
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
