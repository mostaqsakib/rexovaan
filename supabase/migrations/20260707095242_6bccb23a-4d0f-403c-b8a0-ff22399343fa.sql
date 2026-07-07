
CREATE OR REPLACE FUNCTION public.prevent_customer_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role and postgres to update anything
  IF current_setting('request.jwt.claim.role', true) IN ('service_role') THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- For authenticated customers updating their own row, reject changes to sensitive columns
  IF NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.referral_balance IS DISTINCT FROM OLD.referral_balance
     OR NEW.referral_total_earned IS DISTINCT FROM OLD.referral_total_earned
     OR NEW.pay_later_enabled IS DISTINCT FROM OLD.pay_later_enabled
     OR NEW.pay_later_limit IS DISTINCT FROM OLD.pay_later_limit
     OR NEW.pay_later_used IS DISTINCT FROM OLD.pay_later_used
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
  THEN
    RAISE EXCEPTION 'Not allowed to modify protected fields on bot_customers';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_customer_sensitive_updates ON public.bot_customers;
CREATE TRIGGER trg_prevent_customer_sensitive_updates
BEFORE UPDATE ON public.bot_customers
FOR EACH ROW
EXECUTE FUNCTION public.prevent_customer_sensitive_updates();
