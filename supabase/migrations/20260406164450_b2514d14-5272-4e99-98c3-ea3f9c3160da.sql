
ALTER TABLE public.bot_products ADD COLUMN IF NOT EXISTS last_known_stock integer NOT NULL DEFAULT 0;

INSERT INTO public.bot_button_emojis (button_key, button_label) 
VALUES ('stock_alert', 'Stock Alert Notification')
ON CONFLICT DO NOTHING;
