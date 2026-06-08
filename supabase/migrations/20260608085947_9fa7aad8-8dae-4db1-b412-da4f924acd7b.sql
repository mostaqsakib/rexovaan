CREATE TABLE IF NOT EXISTS public.sync_watermarks (
  table_name TEXT PRIMARY KEY,
  watermark_column TEXT NOT NULL,
  last_value TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01'::timestamptz,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  rows_synced_total BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sync_watermarks TO authenticated;
GRANT ALL ON public.sync_watermarks TO service_role;

ALTER TABLE public.sync_watermarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sync watermarks"
  ON public.sync_watermarks FOR SELECT
  TO authenticated
  USING (public.is_admin());
