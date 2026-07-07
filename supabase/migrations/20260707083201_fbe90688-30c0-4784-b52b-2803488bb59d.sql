DROP POLICY IF EXISTS "Customers update own row" ON public.bot_customers;
DROP POLICY IF EXISTS "Customers update own row safe fields" ON public.bot_customers;

REVOKE UPDATE ON public.bot_customers FROM authenticated;
GRANT UPDATE (first_name, username, pending_inputs, pending_action, updated_at)
  ON public.bot_customers TO authenticated;

CREATE POLICY "Customers update own row safe fields"
ON public.bot_customers
FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());