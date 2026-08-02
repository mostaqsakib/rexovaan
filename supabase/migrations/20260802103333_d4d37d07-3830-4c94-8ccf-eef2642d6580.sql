-- Lock down maintenance / internal SECURITY DEFINER functions from public (anon) execution
REVOKE ALL ON FUNCTION public.auto_cleanup_link_check_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_onchain_deposits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ltc_next_index() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_stock_duplicates(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.auto_cleanup_link_check_history() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_onchain_deposits() TO service_role;
GRANT EXECUTE ON FUNCTION public.ltc_next_index() TO service_role;
GRANT EXECUTE ON FUNCTION public.find_stock_duplicates(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(text, integer) TO authenticated, service_role;

-- Trigger-only functions must never be callable directly
REVOKE ALL ON FUNCTION public.handle_new_auth_user_create_customer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_referral_campaign_credit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_referral_total_earned() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_customers_block_sensitive_self_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_customers_guard_self_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_customers_protect_sensitive_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_bot_customer_protected_self_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_bot_customers_sensitive_self_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_customer_sensitive_updates() FROM PUBLIC, anon, authenticated;