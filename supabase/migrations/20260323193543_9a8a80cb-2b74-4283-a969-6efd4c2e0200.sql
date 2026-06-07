ALTER TABLE public.bot_deposits 
  ADD COLUMN IF NOT EXISTS pending_product_id uuid REFERENCES public.bot_products(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_quantity integer DEFAULT NULL;