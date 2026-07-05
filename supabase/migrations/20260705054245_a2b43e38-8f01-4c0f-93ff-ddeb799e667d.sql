
-- 1) bot_customers: restrict UPDATE column-level privileges for customers
REVOKE UPDATE ON public.bot_customers FROM authenticated;
GRANT UPDATE (first_name, username, pending_inputs, pending_action, updated_at)
  ON public.bot_customers TO authenticated;

-- 2) bot_deposits: enforce safe defaults on customer inserts
DROP POLICY IF EXISTS "Customers insert own deposits" ON public.bot_deposits;
CREATE POLICY "Customers insert own deposits"
ON public.bot_deposits
FOR INSERT
TO authenticated
WITH CHECK (
  customer_id = public.current_customer_id()
  AND status = 'pending'
  AND verified_at IS NULL
);
