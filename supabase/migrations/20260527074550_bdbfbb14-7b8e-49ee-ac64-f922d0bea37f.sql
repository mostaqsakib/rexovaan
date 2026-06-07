CREATE TABLE public.site_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info',
  show_as_banner boolean NOT NULL DEFAULT true,
  link_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
GRANT SELECT ON public.site_announcements TO anon;
GRANT SELECT ON public.site_announcements TO authenticated;
GRANT ALL ON public.site_announcements TO service_role;
ALTER TABLE public.site_announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read active announcements" ON public.site_announcements FOR SELECT USING (is_active = true);
CREATE POLICY "Service role full access announcements" ON public.site_announcements FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_site_announcements_active ON public.site_announcements (is_active, created_at DESC);

CREATE TABLE public.customer_announcement_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  announcement_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id, announcement_id)
);
GRANT SELECT, INSERT, DELETE ON public.customer_announcement_reads TO authenticated;
GRANT ALL ON public.customer_announcement_reads TO service_role;
ALTER TABLE public.customer_announcement_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers view own reads" ON public.customer_announcement_reads FOR SELECT TO authenticated USING (customer_id = current_customer_id());
CREATE POLICY "Customers insert own reads" ON public.customer_announcement_reads FOR INSERT TO authenticated WITH CHECK (customer_id = current_customer_id());
CREATE POLICY "Customers delete own reads" ON public.customer_announcement_reads FOR DELETE TO authenticated USING (customer_id = current_customer_id());

CREATE INDEX idx_customer_reads_customer ON public.customer_announcement_reads (customer_id);