-- Fix EXPOSED_SENSITIVE_DATA: restrict bot_payment_methods SELECT to admins only

-- Drop the overly permissive policy that allows any authenticated user to read payment details
DROP POLICY IF EXISTS "Authenticated read payment methods" ON public.bot_payment_methods;

-- Create a new policy restricted to admins only
CREATE POLICY "Admins read payment methods"
  ON public.bot_payment_methods
  FOR SELECT
  TO authenticated
  USING (public.is_admin());