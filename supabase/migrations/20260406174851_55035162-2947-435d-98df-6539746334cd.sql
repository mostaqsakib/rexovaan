
-- Notification preferences per customer
CREATE TABLE public.bot_notification_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.bot_customers(id) ON DELETE CASCADE UNIQUE,
  stock_alerts BOOLEAN NOT NULL DEFAULT true,
  info_alerts BOOLEAN NOT NULL DEFAULT true,
  referral_bonus BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to notification settings" ON public.bot_notification_settings FOR ALL USING (true) WITH CHECK (true);

-- Add new button emoji entries
INSERT INTO public.bot_button_emojis (button_key, button_label) VALUES
  ('menu_profile', 'My Profile'),
  ('profile_notifications', 'Notifications'),
  ('profile_orders', 'My Orders'),
  ('notif_stock', 'Stock Alerts'),
  ('notif_info', 'Info Alerts'),
  ('notif_referral', 'Referral Bonus')
ON CONFLICT DO NOTHING;
