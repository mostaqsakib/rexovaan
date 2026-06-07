INSERT INTO bot_button_emojis (button_key, button_label) VALUES
  ('profile_stats', '📊 My Stats'),
  ('cancel', '❌ Cancel')
ON CONFLICT DO NOTHING;