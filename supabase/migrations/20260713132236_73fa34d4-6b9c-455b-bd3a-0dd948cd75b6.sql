
CREATE OR REPLACE FUNCTION public.merge_customer_accounts(_source_auth_id uuid, _target_auth_id uuid)
RETURNS TABLE(status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  src public.bot_customers%ROWTYPE;
  tgt public.bot_customers%ROWTYPE;
BEGIN
  IF _source_auth_id IS NULL OR _target_auth_id IS NULL OR _source_auth_id = _target_auth_id THEN
    RETURN QUERY SELECT 'error'::text, 'Invalid ids'::text; RETURN;
  END IF;

  SELECT * INTO src FROM public.bot_customers WHERE auth_user_id = _source_auth_id LIMIT 1;
  SELECT * INTO tgt FROM public.bot_customers WHERE auth_user_id = _target_auth_id LIMIT 1;

  IF src.id IS NULL THEN RETURN QUERY SELECT 'error'::text, 'Source customer not found'::text; RETURN; END IF;
  IF tgt.id IS NULL THEN RETURN QUERY SELECT 'error'::text, 'Target customer not found'::text; RETURN; END IF;

  -- Repoint all FK-bearing tables
  UPDATE public.bot_orders                    SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_deposits                  SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_withdrawals               SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_balance_adjustments       SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_referral_earnings         SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_customer_pricing          SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.customer_announcement_reads   SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_notification_settings     SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_resellers                 SET customer_id = tgt.id WHERE customer_id = src.id;
  UPDATE public.bot_referrals                 SET referrer_customer_id = tgt.id WHERE referrer_customer_id = src.id;
  UPDATE public.bot_referrals                 SET referred_customer_id = tgt.id WHERE referred_customer_id = src.id;

  -- Merge balances, prefer target's chat_id/username/first_name but fall back to source
  UPDATE public.bot_customers
  SET balance          = COALESCE(tgt.balance,0)          + COALESCE(src.balance,0),
      pay_later_used   = COALESCE(tgt.pay_later_used,0)   + COALESCE(src.pay_later_used,0),
      referral_balance = COALESCE(tgt.referral_balance,0) + COALESCE(src.referral_balance,0),
      chat_id    = COALESCE(tgt.chat_id, src.chat_id),
      username   = COALESCE(tgt.username, src.username),
      first_name = COALESCE(tgt.first_name, src.first_name),
      updated_at = now()
  WHERE id = tgt.id;

  DELETE FROM public.bot_customers WHERE id = src.id;
  DELETE FROM auth.users WHERE id = _source_auth_id;

  RETURN QUERY SELECT 'ok'::text, 'Accounts merged'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customer_accounts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_customer_accounts(uuid, uuid) TO service_role;
