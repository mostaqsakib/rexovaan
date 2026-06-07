INSERT INTO public.bot_button_emojis (button_key, button_label, style)
VALUES
  ('api_title', 'API Title Emoji', NULL),
  ('api_status', 'API Status Emoji', NULL),
  ('api_balance', 'API Balance Emoji', NULL),
  ('api_key', 'API Key Emoji', NULL),
  ('api_orders', 'API Orders Emoji', NULL),
  ('api_spend', 'API Spend Emoji', NULL),
  ('api_docs', 'API Documentation Button', NULL),
  ('api_generate', 'Generate API Key Button', 'success'),
  ('api_delete', 'Delete API Key Button', 'danger'),
  ('api_dashboard', 'API Dashboard Button', NULL)
ON CONFLICT DO NOTHING;