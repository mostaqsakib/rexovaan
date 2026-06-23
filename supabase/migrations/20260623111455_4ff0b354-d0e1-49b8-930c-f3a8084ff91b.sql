
-- Enforce one reseller per customer at the DB level (race-condition safe).
-- Partial unique index because customer_id can be NULL for legacy/admin-created
-- unlinked resellers.
CREATE UNIQUE INDEX IF NOT EXISTS bot_resellers_one_per_customer
  ON public.bot_resellers (customer_id)
  WHERE customer_id IS NOT NULL;
