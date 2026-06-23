-- Admin audit log
CREATE TABLE public.admin_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  action text NOT NULL,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_action_log TO authenticated;
GRANT ALL ON public.admin_action_log TO service_role;

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log"
  ON public.admin_action_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX idx_admin_action_log_created_at ON public.admin_action_log (created_at DESC);
CREATE INDEX idx_admin_action_log_admin ON public.admin_action_log (admin_user_id, created_at DESC);
CREATE INDEX idx_admin_action_log_target ON public.admin_action_log (target_table, target_id);

-- Bind code attempt tracker (anti-brute-force)
CREATE TABLE public.bot_bind_attempts (
  chat_id bigint PRIMARY KEY,
  fails int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.bot_bind_attempts TO service_role;

ALTER TABLE public.bot_bind_attempts ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies — only service_role (via bot edge fn) touches this.
