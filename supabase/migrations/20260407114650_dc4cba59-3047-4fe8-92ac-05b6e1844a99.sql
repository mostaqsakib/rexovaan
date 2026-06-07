
DROP TABLE IF EXISTS public.web_orders;
DROP TABLE IF EXISTS public.web_customers;
ALTER TABLE public.bot_products DROP COLUMN IF EXISTS web_price;
ALTER TABLE public.bot_payment_methods DROP COLUMN IF EXISTS is_web;
