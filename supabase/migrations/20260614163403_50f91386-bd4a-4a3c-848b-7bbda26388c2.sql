
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- Restrict Realtime channel subscriptions to admins only
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can receive realtime broadcasts" ON realtime.messages;
CREATE POLICY "Admins can receive realtime broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can send realtime broadcasts" ON realtime.messages;
CREATE POLICY "Admins can send realtime broadcasts"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());
