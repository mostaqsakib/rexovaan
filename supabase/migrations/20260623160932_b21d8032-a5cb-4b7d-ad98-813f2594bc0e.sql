
-- ============================================================
-- REFERRAL SYSTEM FIXES (3 bugs + data correction)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- STEP 1: DATA FIX — Refund duplicate join_bonus wallet credits
-- The bot.js campaign block wrongly added join_bonus to wallet
-- balance, while DB trigger ALSO credited referral_balance via
-- campaign_signup. Refund the wallet credits and delete rows.
-- ─────────────────────────────────────────────────────────────

-- Log adjustments per customer BEFORE updating balance
INSERT INTO public.bot_balance_adjustments
  (customer_id, old_balance, new_balance, diff, note, source)
SELECT
  c.id,
  c.balance,
  GREATEST(0, c.balance - agg.total_dup),
  -LEAST(c.balance, agg.total_dup),
  'Refund duplicate join_bonus wallet credit (referral system fix)',
  'system'
FROM public.bot_customers c
JOIN (
  SELECT referrer_id, SUM(amount) AS total_dup
  FROM public.bot_referral_earnings
  WHERE type = 'join_bonus'
  GROUP BY referrer_id
) agg ON agg.referrer_id = c.id
WHERE agg.total_dup > 0;

-- Deduct from wallet balance (capped at 0)
UPDATE public.bot_customers c
SET balance = GREATEST(0, c.balance - agg.total_dup),
    updated_at = now()
FROM (
  SELECT referrer_id, SUM(amount) AS total_dup
  FROM public.bot_referral_earnings
  WHERE type = 'join_bonus'
  GROUP BY referrer_id
) agg
WHERE c.id = agg.referrer_id;

-- Delete the wrongly-recorded join_bonus rows
DELETE FROM public.bot_referral_earnings WHERE type = 'join_bonus';

-- ─────────────────────────────────────────────────────────────
-- STEP 2: BUG 2 FIX — Auto-sync referral_total_earned
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_referral_total_earned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bot_customers
  SET referral_total_earned = COALESCE(referral_total_earned, 0) + COALESCE(NEW.amount, 0),
      updated_at = now()
  WHERE id = NEW.referrer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_referral_total_earned ON public.bot_referral_earnings;
CREATE TRIGGER trg_sync_referral_total_earned
AFTER INSERT ON public.bot_referral_earnings
FOR EACH ROW EXECUTE FUNCTION public.sync_referral_total_earned();

-- Backfill: rebuild referral_total_earned from current earnings
UPDATE public.bot_customers c
SET referral_total_earned = COALESCE(s.total, 0),
    updated_at = now()
FROM (
  SELECT referrer_id, SUM(amount) AS total
  FROM public.bot_referral_earnings
  GROUP BY referrer_id
) s
WHERE c.id = s.referrer_id;

-- Zero out customers with no earnings rows but stale stored values
UPDATE public.bot_customers
SET referral_total_earned = 0
WHERE referral_total_earned > 0
  AND id NOT IN (SELECT DISTINCT referrer_id FROM public.bot_referral_earnings);

-- ─────────────────────────────────────────────────────────────
-- STEP 3: BUG 3 FIX — Atomic commission/first_bonus RPC
-- Replaces the race-prone read-modify-write in bot.js
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_referral_commission_atomic(
  _buyer_customer_id uuid,
  _order_total numeric,
  _order_id uuid,
  _commission_percent numeric,
  _first_bonus_amount numeric
)
RETURNS TABLE(
  commission_credited numeric,
  first_bonus_credited numeric,
  referrer_id uuid,
  referrer_chat_id bigint,
  new_referral_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref      public.bot_referrals%ROWTYPE;
  v_referrer public.bot_customers%ROWTYPE;
  v_commission  numeric := 0;
  v_first_bonus numeric := 0;
  v_total       numeric := 0;
  v_new_balance numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '5000', true);
  PERFORM set_config('lock_timeout',      '3000', true);

  SELECT * INTO v_ref
  FROM public.bot_referrals
  WHERE referred_id = _buyer_customer_id
  LIMIT 1;

  IF v_ref.id IS NULL THEN
    RETURN;
  END IF;

  -- Lock referrer row to prevent lost updates
  SELECT * INTO v_referrer
  FROM public.bot_customers
  WHERE id = v_ref.referrer_id
  FOR UPDATE;

  IF v_referrer.id IS NULL THEN
    RETURN;
  END IF;

  IF _commission_percent > 0 AND _order_total > 0 THEN
    v_commission := ROUND(_order_total * _commission_percent / 100, 4);
  END IF;

  IF NOT COALESCE(v_ref.first_bonus_paid, false) AND _first_bonus_amount > 0 THEN
    v_first_bonus := _first_bonus_amount;
  END IF;

  v_total := v_commission + v_first_bonus;

  IF v_total <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.bot_customers
  SET referral_balance = COALESCE(referral_balance, 0) + v_total,
      updated_at = now()
  WHERE id = v_referrer.id
  RETURNING referral_balance INTO v_new_balance;

  IF v_commission > 0 THEN
    INSERT INTO public.bot_referral_earnings
      (referrer_id, referred_id, amount, type, source_order_id)
    VALUES
      (v_referrer.id, _buyer_customer_id, v_commission, 'commission', _order_id);
  END IF;

  IF v_first_bonus > 0 THEN
    INSERT INTO public.bot_referral_earnings
      (referrer_id, referred_id, amount, type, source_order_id)
    VALUES
      (v_referrer.id, _buyer_customer_id, v_first_bonus, 'first_bonus', _order_id);

    UPDATE public.bot_referrals
    SET first_bonus_paid = true
    WHERE id = v_ref.id;
  END IF;

  RETURN QUERY SELECT
    v_commission,
    v_first_bonus,
    v_referrer.id,
    v_referrer.chat_id,
    v_new_balance;
END;
$$;

-- Lock down: only service_role (bot uses service role) may call
REVOKE EXECUTE ON FUNCTION public.process_referral_commission_atomic(uuid, numeric, uuid, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_referral_commission_atomic(uuid, numeric, uuid, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_referral_commission_atomic(uuid, numeric, uuid, numeric, numeric) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.process_referral_commission_atomic(uuid, numeric, uuid, numeric, numeric) TO service_role;
