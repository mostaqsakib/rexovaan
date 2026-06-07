
-- Add short_code column
ALTER TABLE public.bot_products ADD COLUMN short_code TEXT UNIQUE;

-- Function to generate unique 4-char alphanumeric code
CREATE OR REPLACE FUNCTION generate_product_short_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  done BOOLEAN;
BEGIN
  done := FALSE;
  WHILE NOT done LOOP
    -- Generate 4-char uppercase alphanumeric code
    new_code := upper(substr(md5(random()::text), 1, 4));
    -- Check uniqueness
    done := NOT EXISTS (SELECT 1 FROM public.bot_products WHERE short_code = new_code);
  END LOOP;
  NEW.short_code := new_code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate on insert if not provided
CREATE TRIGGER trg_product_short_code
  BEFORE INSERT ON public.bot_products
  FOR EACH ROW
  WHEN (NEW.short_code IS NULL)
  EXECUTE FUNCTION generate_product_short_code();

-- Backfill existing products
UPDATE public.bot_products SET short_code = upper(substr(md5(id::text), 1, 4))
WHERE short_code IS NULL;
