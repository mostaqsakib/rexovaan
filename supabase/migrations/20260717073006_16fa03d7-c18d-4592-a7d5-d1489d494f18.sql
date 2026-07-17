
CREATE OR REPLACE FUNCTION public.clear_old_link_check_jobs()
RETURNS TABLE(deleted_jobs bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_jobs bigint := 0;
  v_batch int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('statement_timeout', '590000', true);
  PERFORM set_config('lock_timeout', '5000', true);

  -- Batch delete items belonging to old jobs to avoid statement timeout / huge locks
  LOOP
    WITH victims AS (
      SELECT i.ctid
      FROM public.link_check_items i
      JOIN public.link_check_jobs j ON j.id = i.job_id
      WHERE j.status NOT IN ('running','queued','vps_queued')
      LIMIT 20000
    )
    DELETE FROM public.link_check_items i
    USING victims v
    WHERE i.ctid = v.ctid;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch = 0;
  END LOOP;

  -- Now delete old jobs (small — hundreds)
  WITH d AS (
    DELETE FROM public.link_check_jobs
    WHERE status NOT IN ('running','queued','vps_queued')
    RETURNING 1
  )
  SELECT count(*) INTO v_jobs FROM d;

  RETURN QUERY SELECT v_jobs;
END;
$function$;
