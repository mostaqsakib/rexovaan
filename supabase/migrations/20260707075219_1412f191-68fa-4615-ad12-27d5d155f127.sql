
-- Security fix: prevent customers from updating sensitive financial columns via RLS.
-- We keep the existing "Customers update own row" policy but add a trigger that
-- reverts sensitive column changes unless the caller is service_role.
CREATE OR REPLACE FUNCTION public.bot_customers_protect_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := (current_setting('role', true) = 'service_role')
                       OR (auth.role() = 'service_role');
BEGIN
  IF is_service THEN
    RETURN NEW;
  END IF;

  -- Force-revert protected fields to their previous values for non-service roles.
  NEW.balance            := OLD.balance;
  NEW.referral_balance   := OLD.referral_balance;
  NEW.pay_later_enabled  := OLD.pay_later_enabled;
  NEW.pay_later_limit    := OLD.pay_later_limit;
  NEW.pay_later_used     := OLD.pay_later_used;
  NEW.is_banned          := OLD.is_banned;
  NEW.ban_reason         := OLD.ban_reason;
  NEW.chat_id            := OLD.chat_id;
  NEW.auth_user_id       := OLD.auth_user_id;
  NEW.username           := COALESCE(NEW.username, OLD.username);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_customers_protect_sensitive ON public.bot_customers;
CREATE TRIGGER trg_bot_customers_protect_sensitive
BEFORE UPDATE ON public.bot_customers
FOR EACH ROW
EXECUTE FUNCTION public.bot_customers_protect_sensitive_columns();
