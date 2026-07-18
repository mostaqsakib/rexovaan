
-- Fix 1: Column-level UPDATE grants — customers can only update safe profile fields
REVOKE UPDATE ON public.bot_customers FROM authenticated;
GRANT UPDATE (username, first_name, pending_action, pending_inputs) ON public.bot_customers TO authenticated;

-- Fix 2: Correct TON reservations customer policy to use current_customer_id()
DROP POLICY IF EXISTS "Customers can view own TON reservations" ON public.ton_reserved_deposits;
CREATE POLICY "Customers can view own TON reservations"
ON public.ton_reserved_deposits
FOR SELECT
TO authenticated
USING (customer_id = public.current_customer_id());
