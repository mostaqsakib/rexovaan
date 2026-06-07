ALTER TABLE public.bot_resellers
ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;