DROP FUNCTION IF EXISTS public.clear_old_link_check_jobs();

CREATE OR REPLACE FUNCTION public.clear_old_link_check_jobs()
RETURNS TABLE(
  deleted_jobs bigint,
  deleted_items bigint,
  remaining_jobs bigint,
  remaining_items bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_jobs bigint := 0;
  v_deleted_items bigint := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('statement_timeout', '25000', true);
  PERFORM set_config('lock_timeout', '3000', true);

  WITH old_jobs AS (
    SELECT id
    FROM public.link_check_jobs
    WHERE status NOT IN ('running','queued','vps_queued')
    ORDER BY created_at ASC
    LIMIT 50
  ), victims AS (
    SELECT i.id
    FROM public.link_check_items i
    JOIN old_jobs j ON j.id = i.job_id
    ORDER BY i.id
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
    WHERE j.status NOT IN ('running','queued','vps_queued')
      AND NOT EXISTS (
        SELECT 1
        FROM public.link_check_items i
        WHERE i.job_id = j.id
      )
    ORDER BY j.created_at ASC
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

  SELECT count(*) INTO remaining_items
  FROM public.link_check_items i
  WHERE EXISTS (
    SELECT 1
    FROM public.link_check_jobs j
    WHERE j.id = i.job_id
      AND j.status NOT IN ('running','queued','vps_queued')
  );

  deleted_jobs := v_deleted_jobs;
  deleted_items := v_deleted_items;
  RETURN NEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clear_old_link_check_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_old_link_check_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_old_link_check_jobs() TO service_role;