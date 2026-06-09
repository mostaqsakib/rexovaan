
-- 1. Prevent customers from updating sensitive columns on bot_customers
CREATE OR REPLACE FUNCTION public.prevent_customer_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip enforcement for admins and service role
  IF public.is_admin() OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only enforce when the row belongs to the current auth user (self-update path)
  IF NEW.auth_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.pay_later_enabled IS DISTINCT FROM OLD.pay_later_enabled
     OR NEW.pay_later_limit IS DISTINCT FROM OLD.pay_later_limit
     OR NEW.pay_later_used IS DISTINCT FROM OLD.pay_later_used
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
     OR NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'Customers cannot modify protected fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_customer_sensitive_updates ON public.bot_customers;
CREATE TRIGGER trg_prevent_customer_sensitive_updates
BEFORE UPDATE ON public.bot_customers
FOR EACH ROW
EXECUTE FUNCTION public.prevent_customer_sensitive_updates();

-- 2. Restrict instruction-media storage to admins for write/delete
DROP POLICY IF EXISTS "Authenticated can upload instruction-media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete instruction-media" ON storage.objects;

CREATE POLICY "Admins can upload instruction-media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'instruction-media' AND public.is_admin());

CREATE POLICY "Admins can delete instruction-media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'instruction-media' AND public.is_admin());

-- 3. Restrict site-assets storage to admins for write/update
DROP POLICY IF EXISTS "Authenticated can upload site-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update site-assets" ON storage.objects;

CREATE POLICY "Admins can upload site-assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'site-assets' AND public.is_admin());

CREATE POLICY "Admins can update site-assets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'site-assets' AND public.is_admin())
WITH CHECK (bucket_id = 'site-assets' AND public.is_admin());

CREATE POLICY "Admins can delete site-assets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'site-assets' AND public.is_admin());

-- 4. Remove bot_product_stock_items from Realtime publication so digital
-- product delivery data (data JSONB) isn't broadcast to subscribers.
ALTER PUBLICATION supabase_realtime DROP TABLE public.bot_product_stock_items;
