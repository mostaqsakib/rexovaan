CREATE OR REPLACE FUNCTION public.handle_referral_campaign_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active text;
  v_reward numeric;
BEGIN
  SELECT value INTO v_active FROM public.bot_settings WHERE key = 'referral_campaign_active' LIMIT 1;
  IF COALESCE(v_active, 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(value,'')::numeric INTO v_reward FROM public.bot_settings WHERE key = 'referral_campaign_reward' LIMIT 1;
  IF v_reward IS NULL OR v_reward <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bot_referral_earnings
    WHERE referrer_id = NEW.referrer_id
      AND referred_id = NEW.referred_id
      AND type = 'campaign_signup'
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.bot_customers
  SET referral_balance = COALESCE(referral_balance, 0) + v_reward,
      updated_at = now()
  WHERE id = NEW.referrer_id;

  INSERT INTO public.bot_referral_earnings (referrer_id, referred_id, amount, type)
  VALUES (NEW.referrer_id, NEW.referred_id, v_reward, 'campaign_signup');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_referral_campaign_credit failed: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_campaign_credit ON public.bot_referrals;
CREATE TRIGGER trg_referral_campaign_credit
AFTER INSERT ON public.bot_referrals
FOR EACH ROW
EXECUTE FUNCTION public.handle_referral_campaign_credit();