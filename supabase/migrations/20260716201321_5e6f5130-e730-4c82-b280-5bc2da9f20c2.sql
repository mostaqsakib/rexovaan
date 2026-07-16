-- Column-level lockdown for public.bot_customers.
-- Authenticated customers keep RLS-scoped UPDATE, but ONLY on non-sensitive columns.
-- Sensitive financial / security columns (balance, referral_*, pay_later_*, is_banned,
-- ban_reason, banned_at, auth_user_id, chat_id) can now only be modified by
-- service_role code (SECURITY DEFINER RPCs / edge functions). Existing safety
-- triggers stay in place as defense-in-depth.
REVOKE UPDATE ON public.bot_customers FROM authenticated;
REVOKE UPDATE ON public.bot_customers FROM anon;

GRANT UPDATE (
  first_name,
  username,
  pending_action,
  pending_inputs,
  updated_at
) ON public.bot_customers TO authenticated;

GRANT ALL ON public.bot_customers TO service_role;