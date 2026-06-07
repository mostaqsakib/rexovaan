
CREATE TABLE public.bot_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.bot_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.bot_settings (key, value) VALUES (
  'welcome_message',
  E'✨ <b>Welcome to Rexovaan Shop!</b> ✨\n\n🛒 <b>Shop</b> — Browse & buy products\n💰 <b>Balance</b> — Check your wallet\n💳 <b>Deposit</b> — Add funds\n🧾 <b>My Orders</b> — View purchase history\n💸 <b>Withdraw</b> — Withdraw your balance\n🆘 <b>Support</b> — Get help'
);
