
-- 1. google_account_cookies
CREATE TABLE public.google_account_cookies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  cookies_json jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  expired boolean NOT NULL DEFAULT false,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_account_cookies TO authenticated;
GRANT ALL ON public.google_account_cookies TO service_role;
ALTER TABLE public.google_account_cookies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all google_account_cookies" ON public.google_account_cookies FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2. link_check_jobs
CREATE TABLE public.link_check_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.bot_products(id) ON DELETE CASCADE,
  cookie_id uuid REFERENCES public.google_account_cookies(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued', -- queued|running|completed|failed|cancelled
  concurrency int NOT NULL DEFAULT 2,
  delay_ms int NOT NULL DEFAULT 5000,
  total int NOT NULL DEFAULT 0,
  checked int NOT NULL DEFAULT 0,
  valid_count int NOT NULL DEFAULT 0,
  invalid_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.link_check_jobs TO authenticated;
GRANT ALL ON public.link_check_jobs TO service_role;
ALTER TABLE public.link_check_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all link_check_jobs" ON public.link_check_jobs FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3. link_check_items
CREATE TABLE public.link_check_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.link_check_jobs(id) ON DELETE CASCADE,
  stock_item_id uuid REFERENCES public.bot_product_stock_items(id) ON DELETE SET NULL,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending|in_progress|valid|invalid|error|skipped
  reason text,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_link_check_items_job ON public.link_check_items(job_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.link_check_items TO authenticated;
GRANT ALL ON public.link_check_items TO service_role;
ALTER TABLE public.link_check_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin all link_check_items" ON public.link_check_items FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. Extend bot_product_stock_items
ALTER TABLE public.bot_product_stock_items
  ADD COLUMN IF NOT EXISTS invalid_reason text,
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invalidated_job_id uuid;

CREATE INDEX IF NOT EXISTS idx_stock_items_invalid ON public.bot_product_stock_items(product_id, status) WHERE status = 'invalid';

-- 5. RPC: claim next pending link_check_item
CREATE OR REPLACE FUNCTION public.claim_next_link_check_item(_job_id uuid)
RETURNS TABLE(id uuid, url text, stock_item_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT i.id FROM public.link_check_items i
    WHERE i.job_id = _job_id AND i.status = 'pending'
    ORDER BY i.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.link_check_items i
  SET status = 'in_progress'
  FROM picked
  WHERE i.id = picked.id
  RETURNING i.id, i.url, i.stock_item_id;
END;
$$;

-- 6. RPC: mark stock item invalid + bump job counters
CREATE OR REPLACE FUNCTION public.mark_link_check_result(
  _item_id uuid,
  _result text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_id uuid;
  v_job_id uuid;
BEGIN
  UPDATE public.link_check_items
  SET status = _result, reason = _reason, checked_at = now()
  WHERE id = _item_id
  RETURNING stock_item_id, job_id INTO v_stock_id, v_job_id;

  IF v_stock_id IS NOT NULL AND _result = 'invalid' THEN
    UPDATE public.bot_product_stock_items
    SET status = 'invalid',
        invalid_reason = _reason,
        invalidated_at = now(),
        invalidated_job_id = v_job_id,
        updated_at = now()
    WHERE id = v_stock_id AND status = 'available';
  END IF;

  UPDATE public.link_check_jobs
  SET checked = checked + 1,
      valid_count   = valid_count   + CASE WHEN _result = 'valid'   THEN 1 ELSE 0 END,
      invalid_count = invalid_count + CASE WHEN _result = 'invalid' THEN 1 ELSE 0 END,
      error_count   = error_count   + CASE WHEN _result = 'error'   THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE id = v_job_id;
END;
$$;

-- 7. updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_google_cookies_touch ON public.google_account_cookies;
CREATE TRIGGER trg_google_cookies_touch BEFORE UPDATE ON public.google_account_cookies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_link_check_jobs_touch ON public.link_check_jobs;
CREATE TRIGGER trg_link_check_jobs_touch BEFORE UPDATE ON public.link_check_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
