
CREATE OR REPLACE FUNCTION public.prevent_bot_customers_sensitive_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('service_role') THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  NEW.balance := OLD.balance;
  NEW.referral_balance := OLD.referral_balance;
  NEW.referral_total_earned := OLD.referral_total_earned;
  NEW.pay_later_limit := OLD.pay_later_limit;
  NEW.pay_later_enabled := OLD.pay_later_enabled;
  NEW.pay_later_used := OLD.pay_later_used;
  NEW.is_banned := OLD.is_banned;
  NEW.ban_reason := OLD.ban_reason;
  NEW.telegram_id := OLD.telegram_id;
  NEW.auth_user_id := OLD.auth_user_id;

  RETURN NEW;
END;
$$;
