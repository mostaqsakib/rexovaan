
CREATE OR REPLACE FUNCTION public.bot_customers_block_sensitive_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service_role boolean := current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role';
BEGIN
  -- Service role and admins bypass all checks
  IF is_service_role OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Only check further if a customer is updating their own row via anon/authenticated
  IF (
        NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.referral_balance IS DISTINCT FROM OLD.referral_balance
     OR NEW.referral_total_earned IS DISTINCT FROM OLD.referral_total_earned
     OR NEW.pay_later_enabled IS DISTINCT FROM OLD.pay_later_enabled
     OR NEW.pay_later_limit IS DISTINCT FROM OLD.pay_later_limit
     OR NEW.pay_later_used IS DISTINCT FROM OLD.pay_later_used
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
  ) THEN
    RAISE EXCEPTION 'Not allowed to modify protected columns';
  END IF;

  RETURN NEW;
END;
$$;
