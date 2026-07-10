
CREATE OR REPLACE FUNCTION public.expire_stale_onchain_deposits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_ids uuid[];
  n integer := 0;
BEGIN
  -- Collect deposit_ids from all on-chain reservation tables that have expired
  WITH ex AS (
    SELECT deposit_id FROM public.bep20_reserved_addresses
      WHERE expires_at < now() AND deposit_id IS NOT NULL
    UNION
    SELECT deposit_id FROM public.ltc_reserved_addresses
      WHERE expires_at < now() AND deposit_id IS NOT NULL
    UNION
    SELECT deposit_id FROM public.ton_reserved_deposits
      WHERE expires_at < now() AND deposit_id IS NOT NULL
  )
  SELECT array_agg(deposit_id) INTO expired_ids FROM ex;

  IF expired_ids IS NULL OR array_length(expired_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.bot_deposits
    SET status = 'rejected'
    WHERE id = ANY(expired_ids)
      AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Schedule every minute
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire_stale_onchain_deposits') THEN
    PERFORM cron.schedule('expire_stale_onchain_deposits', '* * * * *', $cron$SELECT public.expire_stale_onchain_deposits();$cron$);
  END IF;
END $$;

-- Immediate one-shot cleanup of already-stale rows
SELECT public.expire_stale_onchain_deposits();
