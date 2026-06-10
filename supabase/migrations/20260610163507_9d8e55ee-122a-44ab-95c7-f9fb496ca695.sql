
-- Table: temporary bind codes for "bind via /bind <code>" flow
CREATE TABLE public.bot_telegram_bind_codes (
  code text PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz
);

GRANT ALL ON public.bot_telegram_bind_codes TO service_role;
ALTER TABLE public.bot_telegram_bind_codes ENABLE ROW LEVEL SECURITY;
-- No public policies; only service role (via edge functions) touches this table

CREATE INDEX idx_bind_codes_user ON public.bot_telegram_bind_codes(auth_user_id);
CREATE INDEX idx_bind_codes_expires ON public.bot_telegram_bind_codes(expires_at);

-- Core merge function: binds Telegram chat_id to a given auth user, merging an existing bot-only customer if any.
-- Returns:
--   status = 'ok'           -> bind successful
--   status = 'conflict'     -> chat_id already bound to a different real-email account
--   status = 'already_self' -> user already has this chat_id bound
CREATE OR REPLACE FUNCTION public.bind_telegram_to_customer(
  _auth_user_id uuid,
  _chat_id bigint,
  _username text,
  _first_name text
)
RETURNS TABLE(status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.bot_customers%ROWTYPE;
  existing_row public.bot_customers%ROWTYPE;
  other_auth_email text;
  old_synthetic_auth_id uuid;
BEGIN
  -- Find the auth user's current customer row (created on signup)
  SELECT * INTO current_row FROM public.bot_customers WHERE auth_user_id = _auth_user_id LIMIT 1;
  IF current_row.id IS NULL THEN
    RETURN QUERY SELECT 'error'::text, 'No customer record for user'::text; RETURN;
  END IF;

  -- Already bound to this chat_id?
  IF current_row.chat_id = _chat_id THEN
    RETURN QUERY SELECT 'already_self'::text, 'Already bound'::text; RETURN;
  END IF;

  -- Look for an existing row with this chat_id
  SELECT * INTO existing_row FROM public.bot_customers WHERE chat_id = _chat_id LIMIT 1;

  IF existing_row.id IS NOT NULL THEN
    -- Check if it's already bound to another real-email auth user
    IF existing_row.auth_user_id IS NOT NULL AND existing_row.auth_user_id <> _auth_user_id THEN
      SELECT email INTO other_auth_email FROM auth.users WHERE id = existing_row.auth_user_id;
      IF other_auth_email IS NOT NULL AND other_auth_email NOT LIKE '%@telegram.local' THEN
        RETURN QUERY SELECT 'conflict'::text, 'This Telegram account is already linked to another account'::text;
        RETURN;
      END IF;
      old_synthetic_auth_id := existing_row.auth_user_id;
    END IF;

    -- Merge: move all data from current_row INTO existing_row, then delete current_row.
    -- Re-point all FK-bearing tables that reference customer_id.
    UPDATE public.bot_orders                          SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_deposits                        SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_withdrawals                     SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_balance_adjustments             SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_referral_earnings               SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_customer_pricing                SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.customer_announcement_reads        SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_notification_settings           SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_resellers                       SET customer_id = existing_row.id WHERE customer_id = current_row.id;
    UPDATE public.bot_referrals                       SET referrer_customer_id = existing_row.id WHERE referrer_customer_id = current_row.id;
    UPDATE public.bot_referrals                       SET referred_customer_id = existing_row.id WHERE referred_customer_id = current_row.id;

    -- Merge balances and counters into existing_row
    UPDATE public.bot_customers
    SET balance = COALESCE(existing_row.balance,0) + COALESCE(current_row.balance,0),
        pay_later_used = COALESCE(existing_row.pay_later_used,0) + COALESCE(current_row.pay_later_used,0),
        referral_balance = COALESCE(existing_row.referral_balance,0) + COALESCE(current_row.referral_balance,0),
        auth_user_id = _auth_user_id,
        first_name = COALESCE(NULLIF(_first_name,''), existing_row.first_name, current_row.first_name),
        username = COALESCE(NULLIF(_username,''), existing_row.username, current_row.username),
        updated_at = now()
    WHERE id = existing_row.id;

    -- Drop the old synthetic web row
    DELETE FROM public.bot_customers WHERE id = current_row.id;

    -- Remove the orphaned synthetic auth user that previously owned existing_row, if any
    IF old_synthetic_auth_id IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = old_synthetic_auth_id;
    END IF;

    RETURN QUERY SELECT 'ok'::text, 'Merged existing Telegram customer'::text;
    RETURN;
  END IF;

  -- No existing row for this chat_id: just update current row in place.
  UPDATE public.bot_customers
  SET chat_id = _chat_id,
      username = COALESCE(NULLIF(_username,''), username),
      first_name = COALESCE(NULLIF(_first_name,''), first_name),
      updated_at = now()
  WHERE id = current_row.id;

  RETURN QUERY SELECT 'ok'::text, 'Bound to current account'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_telegram_to_customer(uuid, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_telegram_to_customer(uuid, bigint, text, text) TO service_role;
