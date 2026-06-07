INSERT INTO public.bot_button_emojis (button_key, button_label, style)
VALUES ('developer_api', 'Developer API Button', NULL)
ON CONFLICT (button_key) DO UPDATE
SET button_label = EXCLUDED.button_label;