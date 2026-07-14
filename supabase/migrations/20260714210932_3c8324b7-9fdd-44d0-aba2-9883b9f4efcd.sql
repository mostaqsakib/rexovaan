
TRUNCATE TABLE public.link_check_items;
TRUNCATE TABLE public.link_check_jobs CASCADE;

CREATE OR REPLACE FUNCTION public.clear_old_link_check_jobs()
RETURNS TABLE(deleted_jobs bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jobs bigint := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('statement_timeout', '120000', true);

  DELETE FROM public.link_check_items i
  USING public.link_check_jobs j
  WHERE i.job_id = j.id
    AND j.status NOT IN ('running','queued','vps_queued');

  WITH d AS (
    DELETE FROM public.link_check_jobs
    WHERE status NOT IN ('running','queued','vps_queued')
    RETURNING 1
  )
  SELECT count(*) INTO v_jobs FROM d;

  RETURN QUERY SELECT v_jobs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_old_link_check_jobs() TO authenticated;
