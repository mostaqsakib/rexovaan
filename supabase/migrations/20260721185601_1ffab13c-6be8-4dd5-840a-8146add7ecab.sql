
-- Daily auto-cleanup for Run Check history. Keeps invalid stock items intact.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.auto_cleanup_link_check_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_items int := 0;
  v_deleted_jobs int := 0;
  v_batch int;
BEGIN
  -- 1) Delete link_check_items for finished jobs (completed / failed / cancelled), batched
  LOOP
    WITH victims AS (
      SELECT lci.id
      FROM public.link_check_items lci
      JOIN public.link_check_jobs j ON j.id = lci.job_id
      WHERE j.status IN ('completed','failed','cancelled')
      LIMIT 20000
    )
    DELETE FROM public.link_check_items
    WHERE id IN (SELECT id FROM victims);
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted_items := v_deleted_items + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;

  -- 2) Delete the finished jobs themselves (Run Check history rows)
  LOOP
    WITH victims AS (
      SELECT id FROM public.link_check_jobs
      WHERE status IN ('completed','failed','cancelled')
      LIMIT 5000
    )
    DELETE FROM public.link_check_jobs
    WHERE id IN (SELECT id FROM victims);
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted_jobs := v_deleted_jobs + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;

  RAISE NOTICE 'auto_cleanup_link_check_history: deleted % items, % jobs', v_deleted_items, v_deleted_jobs;
END;
$$;

-- Unschedule any prior version, then schedule fresh: every day at 03:00 UTC
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'link-check-daily-cleanup' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'link-check-daily-cleanup',
  '0 3 * * *',
  $$SELECT public.auto_cleanup_link_check_history();$$
);
