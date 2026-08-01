CREATE OR REPLACE FUNCTION public.bot_customers_protect_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  jwt_sub text;
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF (current_setting('role', true) = 'service_role') OR (auth.role() = 'service_role') THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_sub := current_setting('request.jwt.claims', true)::jsonb->>'sub';
  EXCEPTION WHEN OTHERS THEN
    jwt_sub := NULL;
  END;

  IF jwt_sub IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.balance                := OLD.balance;
  NEW.referral_balance       := OLD.referral_balance;
  NEW.referral_total_earned  := OLD.referral_total_earned;
  NEW.referral_transferred   := OLD.referral_transferred;
  NEW.pay_later_enabled      := OLD.pay_later_enabled;
  NEW.pay_later_limit        := OLD.pay_later_limit;
  NEW.pay_later_used         := OLD.pay_later_used;
  NEW.is_banned              := OLD.is_banned;
  NEW.ban_reason             := OLD.ban_reason;
  NEW.banned_at              := OLD.banned_at;
  NEW.chat_id                := OLD.chat_id;
  NEW.auth_user_id           := OLD.auth_user_id;
  NEW.username               := COALESCE(NEW.username, OLD.username);
  RETURN NEW;
END;
$function$;