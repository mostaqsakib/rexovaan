
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-from-old-every-minute') THEN
    PERFORM cron.unschedule('sync-from-old-every-minute');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-from-old-db-every-minute') THEN
    PERFORM cron.unschedule('sync-from-old-db-every-minute');
  END IF;
END $$;
