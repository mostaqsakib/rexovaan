
CREATE TABLE public.bot_broadcast_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  title TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_broadcast_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.bot_broadcast_groups FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.bot_keyword_triggers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.bot_products(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_keyword_triggers_active ON public.bot_keyword_triggers(is_active);
ALTER TABLE public.bot_keyword_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.bot_keyword_triggers FOR ALL USING (true) WITH CHECK (true);
