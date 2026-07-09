GRANT SELECT ON public.bep20_reserved_addresses TO authenticated;
GRANT SELECT ON public.bep20_payment_registry TO authenticated;

CREATE POLICY "Admins can view BEP20 reserved addresses"
  ON public.bep20_reserved_addresses
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view BEP20 payment registry"
  ON public.bep20_payment_registry
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));