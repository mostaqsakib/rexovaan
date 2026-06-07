# Full Proper Security Fix

Goal: Remove the hardcoded PIN, give the admin a real Supabase login, and lock every admin table so the anon key cannot read or write it. Customer-facing data stays reachable through existing customer auth and a few intentionally public reads.

## 1. Database — roles + lock policies

**New:**
- `app_role` enum (`admin`, `customer`)
- `user_roles` table (user_id, role) — RLS enabled, only service role writes
- `has_role(uuid, app_role)` SECURITY DEFINER function

**Rewrite policies on every admin-only table** (drop `USING (true)` / public ALL policies, replace with `has_role(auth.uid(), 'admin')`):

- `bot_customers`, `bot_orders`, `bot_deposits`, `bot_withdrawals`
- `bot_resellers`, `bot_reseller_orders`, `bot_reseller_balance_transactions`
- `bot_product_sources` (contains API keys — currently leakable)
- `bot_product_stock_items` (contains sold license codes)
- `bot_balance_adjustments`, `bot_referrals`, `bot_referral_earnings`
- `bot_settings` — admin write; keep narrow public read only for `site_logo_url`, `site_shop_name`, `dollar_rate_bdt`
- `bot_button_emojis`, `bot_broadcast_groups`, `bot_keyword_triggers`, `bot_customer_pricing` (admin write), `bot_custom_emoji_cache` (admin write), `bot_flash_sales` (admin write), `bot_payment_methods` (admin write), `bot_product_pricing` (admin write), `bot_products` (admin write), `site_announcements` (admin write), `telegram_bot_state`
- Storage bucket `custom-emojis`: only admin can upload/delete (public read stays)

Customer policies (`current_customer_id()`) stay as-is — those are already correct.

## 2. Admin login flow

- New `/admin/login` page → email + password via `supabase.auth.signInWithPassword`
- After login, `AdminAuthContext` checks `has_role(uid, 'admin')`; if not → sign out + Access Denied
- Remove hardcoded PIN `3695` and the `sessionStorage` PIN bypass entirely
- Bootstrap: I'll create one admin user (you give me the email) and insert their `user_roles` row

## 3. Telegram WebApp admin flow

`telegram-auth` edge function currently just returns `{ authorized: true }`. Upgrade it to:
- Validate Telegram initData (already does)
- If admin chat_id matches `ADMIN_CHAT_ID`, mint a Supabase session for the linked admin auth user (`admin.generateLink` → exchange to session) and return it
- Frontend calls `supabase.auth.setSession(...)` with returned tokens

This way Telegram-launched admin gets the same authenticated Supabase session as browser login — all queries Just Work under the new RLS.

## 4. Edge functions

Most admin edge functions (`admin-*`) already use service role internally, so they're fine. I'll add `has_role` verification at the top of each one (currently they trust the caller).

## 5. Frontend cleanup

- Delete PIN UI from `src/pages/Index.tsx`
- Add `src/pages/AdminLogin.tsx`
- Update `AdminAuthContext` to use Supabase session + role check
- No changes needed in 30+ admin tab components — they already use `supabase` client; once the session is authenticated as admin, RLS allows the queries

## What you need to provide

1. **Admin email + initial password** for the bootstrap admin account
2. Confirm: should existing Telegram admin (chat_id from `ADMIN_CHAT_ID` secret) be auto-linked to this same account on first WebApp launch? (Recommended: yes)

## Risk & rollout

- Big migration — I'll do it in one transactional migration so policies don't get half-applied
- After deploy: PIN no longer works. You log in with email/password on `/admin/login`, or open the Telegram WebApp (seamless).
- If anything breaks, the migration is reversible by restoring old policies.

## Estimated scope
- 1 large DB migration (~200 lines SQL)
- 1 edge function update (`telegram-auth`)
- 1 new page, 1 rewritten context, 1 cleaned Index page
- ~6–8 admin edge functions get a `has_role` guard added
