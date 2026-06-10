-- 1. Restrict internal product columns from anonymous users
REVOKE SELECT (sheet_tab, sold_column, sold_value, detail_columns, source_product_id, delivery_instruction, delivery_media) ON public.bot_products FROM anon;

-- 2. Drop the unrestricted storage insert policy on custom-emojis (admins policy already covers admin uploads; service role bypasses RLS)
DROP POLICY IF EXISTS "Service role write custom emojis" ON storage.objects;