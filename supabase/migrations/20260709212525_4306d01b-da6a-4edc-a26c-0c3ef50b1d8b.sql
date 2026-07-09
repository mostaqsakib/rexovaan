
INSERT INTO public.bot_payment_methods (name, payment_details, payment_type, sort_order, is_active, enabled_for_deposit, enabled_for_purchase, emoji, custom_emoji_id, instruction)
VALUES (
  'USDT Polygon',
  'auto',
  'polygon',
  3,
  true,
  true,
  true,
  '🟣',
  NULL,
  'Unique Polygon address generated per deposit. Send USDT or USDC (Polygon / MATIC). Auto-verified after ~20 confirmations (~40 sec).'
);
