
CREATE OR REPLACE FUNCTION public.admin_search_orders(q text, lim int DEFAULT 1000)
RETURNS SETOF public.bot_orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
  FROM public.bot_orders o
  LEFT JOIN public.bot_customers c ON c.id = o.customer_id
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (
      q IS NULL OR q = '' OR
      o.product_name ILIKE '%'||q||'%' OR
      o.id::text ILIKE '%'||q||'%' OR
      COALESCE(o.txn_hash,'') ILIKE '%'||q||'%' OR
      COALESCE(o.delivered_items::text,'') ILIKE '%'||q||'%' OR
      COALESCE(o.details::text,'') ILIKE '%'||q||'%' OR
      COALESCE(c.username,'') ILIKE '%'||q||'%' OR
      COALESCE(c.first_name,'') ILIKE '%'||q||'%' OR
      COALESCE(c.chat_id::text,'') ILIKE '%'||q||'%'
    )
  ORDER BY o.created_at DESC
  LIMIT GREATEST(lim, 1);
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_orders(text, int) TO authenticated;
