ALTER TABLE public.bot_deposits
  ADD COLUMN IF NOT EXISTS prompt_message_id bigint,
  ADD COLUMN IF NOT EXISTS prompt_chat_id bigint;