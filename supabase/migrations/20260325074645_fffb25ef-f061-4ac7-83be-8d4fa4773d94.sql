
CREATE TABLE public.bot_button_emojis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  button_key text NOT NULL UNIQUE,
  button_label text NOT NULL,
  custom_emoji_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_button_emojis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.bot_button_emojis FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.bot_button_emojis (button_key, button_label) VALUES
  ('shop', '🛒 Shop'),
  ('balance', '💰 Balance'),
  ('deposit', '💳 Deposit'),
  ('my_orders', '🧾 My Orders'),
  ('withdraw', '💸 Withdraw'),
  ('support', '🆘 Support'),
  ('back', '◀️ Back'),
  ('cancel_order', '❌ Cancel Order'),
  ('verify_deposit', '✅ Verify Deposit'),
  ('reject_deposit', '❌ Reject Deposit'),
  ('approve_withdrawal', '✅ Approve Withdrawal'),
  ('reject_withdrawal', '❌ Reject Withdrawal'),
  ('contact_support', '💬 Contact Support'),
  ('admin_panel', '🖥️ Open Admin Panel'),
  ('download_txt', '📄 TXT Download'),
  ('download_csv', '📁 CSV Download');
