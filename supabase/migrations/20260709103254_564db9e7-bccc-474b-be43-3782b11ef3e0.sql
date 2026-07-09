CREATE OR REPLACE FUNCTION public.prevent_bot_customer_protected_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND NOT public.is_admin()
     AND OLD.auth_user_id = auth.uid()
  THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.balance IS DISTINCT FROM OLD.balance
       OR NEW.referral_balance IS DISTINCT FROM OLD.referral_balance
       OR NEW.referral_total_earned IS DISTINCT FROM OLD.referral_total_earned
       OR NEW.referral_transferred IS DISTINCT FROM OLD.referral_transferred
       OR NEW.pay_later_enabled IS DISTINCT FROM OLD.pay_later_enabled
       OR NEW.pay_later_limit IS DISTINCT FROM OLD.pay_later_limit
       OR NEW.pay_later_used IS DISTINCT FROM OLD.pay_later_used
       OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
       OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
       OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
    THEN
      RAISE EXCEPTION 'Customers cannot update protected account fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_bot_customer_protected_self_update_trigger ON public.bot_customers;
CREATE TRIGGER prevent_bot_customer_protected_self_update_trigger
BEFORE UPDATE ON public.bot_customers
FOR EACH ROW
EXECUTE FUNCTION public.prevent_bot_customer_protected_self_update();