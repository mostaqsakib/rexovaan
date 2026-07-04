DROP POLICY IF EXISTS "Customers update own row limited" ON public.bot_customers;

CREATE POLICY "Customers update own row"
ON public.bot_customers
FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.bot_customers_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND NEW.auth_user_id IS NOT DISTINCT FROM auth.uid()
     AND OLD.auth_user_id IS NOT DISTINCT FROM auth.uid()
  THEN
    IF NEW.balance               IS DISTINCT FROM OLD.balance
    OR NEW.pay_later_enabled     IS DISTINCT FROM OLD.pay_later_enabled
    OR NEW.pay_later_limit       IS DISTINCT FROM OLD.pay_later_limit
    OR NEW.pay_later_used        IS DISTINCT FROM OLD.pay_later_used
    OR NEW.is_banned             IS DISTINCT FROM OLD.is_banned
    OR NEW.ban_reason            IS DISTINCT FROM OLD.ban_reason
    OR NEW.banned_at             IS DISTINCT FROM OLD.banned_at
    OR NEW.referral_balance      IS DISTINCT FROM OLD.referral_balance
    OR NEW.referral_total_earned IS DISTINCT FROM OLD.referral_total_earned
    OR NEW.referral_transferred  IS DISTINCT FROM OLD.referral_transferred
    OR NEW.auth_user_id          IS DISTINCT FROM OLD.auth_user_id
    OR NEW.chat_id               IS DISTINCT FROM OLD.chat_id
    THEN
      RAISE EXCEPTION 'Customers cannot modify protected fields on bot_customers'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_customers_guard_self_update ON public.bot_customers;
CREATE TRIGGER trg_bot_customers_guard_self_update
BEFORE UPDATE ON public.bot_customers
FOR EACH ROW
EXECUTE FUNCTION public.bot_customers_guard_self_update();