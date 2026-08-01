CREATE OR REPLACE FUNCTION public.bot_customers_protect_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  jwt_sub text;
BEGIN
  -- Server-side / admin tooling connections bypass
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

  -- No JWT context (direct SQL, cron) → allow
  IF jwt_sub IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins bypass
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Customers: force-revert protected fields
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
$function$;