INSERT INTO public.bot_button_emojis (button_key, button_label, custom_emoji_id)
VALUES ('cryptomus_pay', '🪙 Pay with Crypto', '5071060314359859038')
ON CONFLICT (button_key) DO UPDATE SET custom_emoji_id = EXCLUDED.custom_emoji_id, button_label = EXCLUDED.button_label;