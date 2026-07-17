DROP POLICY IF EXISTS "admin all google_account_cookies" ON public.google_account_cookies;
REVOKE ALL ON public.google_account_cookies FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.google_account_cookies TO service_role;