
INSERT INTO public.bot_button_emojis (button_key, button_label, custom_emoji_id)
VALUES ('bulk_pricing', 'Bulk Pricing Header Emoji', '5406683434124859552')
ON CONFLICT (button_key) DO NOTHING;

UPDATE public.bot_settings
SET value = '<tg-emoji emoji-id="5424818078833715060">📣</tg-emoji> <b>{added} new stock added for {product}!</b>

<tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji> Available: <b>{stock}</b> items
<tg-emoji emoji-id="5278223861404421915">💰</tg-emoji> Price: <b>{price} USDT</b>
{bulk_pricing}'
WHERE key = 'msg_stock_alert';
