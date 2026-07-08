
CREATE TABLE IF NOT EXISTS public.bot_emoji_sticker_sets (
  set_name text PRIMARY KEY,
  title text,
  emojis jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bot_emoji_sticker_sets TO authenticated;
GRANT ALL ON public.bot_emoji_sticker_sets TO service_role;

ALTER TABLE public.bot_emoji_sticker_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read emoji sticker sets"
  ON public.bot_emoji_sticker_sets FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins manage emoji sticker sets"
  ON public.bot_emoji_sticker_sets FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Security fix for bot_customers self-update
DROP POLICY IF EXISTS "Customers update own row safe fields" ON public.bot_customers;

CREATE OR REPLACE FUNCTION public.bot_customers_block_sensitive_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.referral_balance IS DISTINCT FROM OLD.referral_balance
     OR NEW.referral_total_earned IS DISTINCT FROM OLD.referral_total_earned
     OR NEW.pay_later_enabled IS DISTINCT FROM OLD.pay_later_enabled
     OR NEW.pay_later_limit IS DISTINCT FROM OLD.pay_later_limit
     OR NEW.pay_later_used IS DISTINCT FROM OLD.pay_later_used
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.telegram_id IS DISTINCT FROM OLD.telegram_id
  THEN
    RAISE EXCEPTION 'Not permitted to modify protected fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_customers_block_sensitive_self_update ON public.bot_customers;
CREATE TRIGGER trg_bot_customers_block_sensitive_self_update
  BEFORE UPDATE ON public.bot_customers
  FOR EACH ROW
  EXECUTE FUNCTION public.bot_customers_block_sensitive_self_update();

CREATE POLICY "Customers update own row safe fields"
  ON public.bot_customers FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
