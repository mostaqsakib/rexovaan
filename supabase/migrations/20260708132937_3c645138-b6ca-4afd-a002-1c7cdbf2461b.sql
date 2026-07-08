
CREATE OR REPLACE FUNCTION public.bot_customers_block_sensitive_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text;
  jwt_sub text;
BEGIN
  -- Allow superuser / postgres / service_role connections (server-side, admin tooling)
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
    jwt_sub  := current_setting('request.jwt.claims', true)::jsonb->>'sub';
  EXCEPTION WHEN OTHERS THEN
    jwt_role := NULL;
    jwt_sub := NULL;
  END;

  IF jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- No JWT (e.g. direct SQL / cron / admin tool) → allow
  IF jwt_sub IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins bypass
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

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
