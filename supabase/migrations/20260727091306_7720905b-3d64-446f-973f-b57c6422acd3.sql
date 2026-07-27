
CREATE INDEX IF NOT EXISTS idx_link_check_jobs_status_created
  ON public.link_check_jobs (status, created_at);

CREATE OR REPLACE FUNCTION public.clear_old_link_check_jobs()
 RETURNS TABLE(deleted_jobs bigint, deleted_items bigint, remaining_jobs bigint, remaining_items bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_jobs bigint := 0;
  v_deleted_items bigint := 0;
  v_old_job_ids uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('statement_timeout', '25000', true);
  PERFORM set_config('lock_timeout', '3000', true);

  SELECT array_agg(id) INTO v_old_job_ids
  FROM (
    SELECT id
    FROM public.link_check_jobs
    WHERE status NOT IN ('running','queued','vps_queued')
    ORDER BY created_at ASC
    LIMIT 50
  ) s;

  IF v_old_job_ids IS NULL THEN
    v_old_job_ids := ARRAY[]::uuid[];
  END IF;

  WITH victims AS (
    SELECT id
    FROM public.link_check_items
    WHERE job_id = ANY(v_old_job_ids)
    LIMIT 50000
  ), deleted AS (
    DELETE FROM public.link_check_items i
    USING victims v
    WHERE i.id = v.id
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_items FROM deleted;

  WITH deletable_jobs AS (
    SELECT j.id
    FROM public.link_check_jobs j
    WHERE j.id = ANY(v_old_job_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.link_check_items i WHERE i.job_id = j.id
      )
    LIMIT 200
  ), deleted AS (
    DELETE FROM public.link_check_jobs j
    USING deletable_jobs d
    WHERE j.id = d.id
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_jobs FROM deleted;

  SELECT count(*) INTO remaining_jobs
  FROM public.link_check_jobs
  WHERE status NOT IN ('running','queued','vps_queued');

  -- Approximate remaining items count via job join, capped for speed
  SELECT COALESCE(sum(cnt), 0) INTO remaining_items
  FROM (
    SELECT count(*) AS cnt
    FROM public.link_check_items i
    WHERE i.job_id IN (
      SELECT id FROM public.link_check_jobs
      WHERE status NOT IN ('running','queued','vps_queued')
      LIMIT 500
    )
  ) s;

  deleted_jobs := v_deleted_jobs;
  deleted_items := v_deleted_items;
  RETURN NEXT;
END;
$function$;
