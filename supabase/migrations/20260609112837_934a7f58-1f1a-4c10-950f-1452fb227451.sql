
CREATE OR REPLACE FUNCTION public.get_bot_quick_stats(_today timestamptz, _week timestamptz, _month timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  WITH
  rev AS (
    SELECT
      COALESCE(SUM(total_price),0)::numeric AS total_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE created_at >= _today),0)::numeric AS today_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE created_at >= _week),0)::numeric AS week_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE created_at >= _month),0)::numeric AS month_revenue,
      COUNT(*) FILTER (WHERE created_at >= _today) AS today_orders,
      COUNT(*) FILTER (WHERE created_at >= _week) AS week_orders,
      COUNT(*) FILTER (WHERE created_at >= _month) AS month_orders,
      COUNT(*) AS total_orders,
      MIN(created_at) AS first_order_at
    FROM bot_orders
  ),
  top_all AS (
    SELECT product_name, SUM(quantity)::bigint AS qty, SUM(total_price)::numeric AS revenue
    FROM bot_orders GROUP BY product_name ORDER BY qty DESC LIMIT 5
  ),
  top_week AS (
    SELECT product_name, SUM(quantity)::bigint AS qty, SUM(total_price)::numeric AS revenue
    FROM bot_orders WHERE created_at >= _week GROUP BY product_name ORDER BY qty DESC LIMIT 5
  ),
  top_month AS (
    SELECT product_name, SUM(quantity)::bigint AS qty, SUM(total_price)::numeric AS revenue
    FROM bot_orders WHERE created_at >= _month GROUP BY product_name ORDER BY qty DESC LIMIT 5
  ),
  buyers_all AS (
    SELECT o.customer_id, c.first_name, c.username, c.chat_id,
      COUNT(*)::bigint AS orders, SUM(o.quantity)::bigint AS qty, SUM(o.total_price)::numeric AS spent
    FROM bot_orders o LEFT JOIN bot_customers c ON c.id = o.customer_id
    GROUP BY o.customer_id, c.first_name, c.username, c.chat_id
    ORDER BY spent DESC LIMIT 5
  ),
  buyers_month AS (
    SELECT o.customer_id, c.first_name, c.username, c.chat_id,
      COUNT(*)::bigint AS orders, SUM(o.quantity)::bigint AS qty, SUM(o.total_price)::numeric AS spent
    FROM bot_orders o LEFT JOIN bot_customers c ON c.id = o.customer_id
    WHERE o.created_at >= _month
    GROUP BY o.customer_id, c.first_name, c.username, c.chat_id
    ORDER BY spent DESC LIMIT 5
  )
  SELECT jsonb_build_object(
    'rev', (SELECT row_to_json(rev) FROM rev),
    'top_all', COALESCE((SELECT jsonb_agg(t) FROM top_all t), '[]'::jsonb),
    'top_week', COALESCE((SELECT jsonb_agg(t) FROM top_week t), '[]'::jsonb),
    'top_month', COALESCE((SELECT jsonb_agg(t) FROM top_month t), '[]'::jsonb),
    'buyers_all', COALESCE((SELECT jsonb_agg(b) FROM buyers_all b), '[]'::jsonb),
    'buyers_month', COALESCE((SELECT jsonb_agg(b) FROM buyers_month b), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bot_quick_stats(timestamptz, timestamptz, timestamptz) TO authenticated, service_role, anon;
