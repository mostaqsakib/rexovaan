# Security Hardening Round 1 — Applied 2026-06-23

Resolved findings from `migration/security-audit-report.md`.

## Critical fixes applied

| # | Fix | Files |
|---|-----|-------|
| C1 | `REVOKE EXECUTE` on balance & stock RPCs (`deduct_customer_balance`, `refund_customer_balance`, `deduct_pay_later_credit`, `refund_pay_later_credit`, `reserve_internal_stock_items`, `restore_internal_stock_items`, `claim_pending_delivery_order`) from `PUBLIC`/`anon`/`authenticated`; granted to `service_role` only | migration |
| C2 | `REVOKE EXECUTE` on `get_bot_quick_stats` from `anon`/`authenticated`; `service_role` only | migration |
| C3 | `REVOKE EXECUTE` on `get_product_stock_items` from `anon`/`authenticated`; `service_role` only | migration |
| C4 | Added `requireAdmin` to `send-bot-message` | edge fn |
| C5 | Added `requireAdmin` to `send-all-email-previews`; recipient now from env var | edge fn |
| C6 | `sync-from-old` and `sync-from-old-db` now require `x-sync-secret` header (timing-safe compare against `SYNC_SHARED_SECRET`) | edge fn |
| C7 | `bootstrap-email-cron` now requires `Bearer CRON_SHARED_SECRET` | edge fn |
| C8 | `bkash-callback` credits balance via `refund_customer_balance` RPC (atomic row lock); partial UNIQUE INDEX on `bot_deposits.txn_hash` for live statuses prevents double-credit | edge fn + migration |
| C9 | New `create-withdrawal` edge function calls atomic `create_withdrawal_atomic` RPC; client-side 2-step flow removed; legacy customer INSERT policy on `bot_withdrawals` dropped | edge fn + migration + frontend |

## High fixes applied

| # | Fix |
|---|-----|
| H1 | Partial UNIQUE INDEX on `bot_deposits(txn_hash) WHERE status NOT IN ('rejected','bkash_cancelled')` |
| H2 | `admin-confirm-withdrawal` uses atomic conditional `UPDATE … WHERE status='pending' RETURNING *` |
| H3 | `admin-reject-withdrawal` uses atomic conditional update + `refund_customer_balance` RPC |
| H4 | `admin-refund-order` uses atomic conditional `UPDATE … WHERE status!='refunded' RETURNING *` as the gate |
| H7 | `customer-checkout`, `bkash-create-payment`, `upload-order-delivery-file` switched from `getClaims` to `getUser` (server-validated, blocks banned/deleted users) |
| H9 | `resolve-payment-methods` no longer resolves env vars from DB values (closes service-role exfiltration vector) |
| H10 | `telegram-auth` launch token now signed with dedicated `ADMIN_LAUNCH_TOKEN_SECRET` (falls back to legacy secret only if new one absent) |
| H11 | Shared `timingSafeEqual` in `_shared/timing-safe.ts`; used in `bot-bind-telegram-confirm`, `bot-reseller-api-manage`, `telegram-auth`, `telegram-webapp-auth`, `telegram-widget-auth`, `customer-bind-telegram` |
| H12 | `get-custom-emojis`: anon callers get cached results only; Telegram fetch + storage upload requires authenticated user |
| H14 | `google_account_cookies` table grants reduced to `service_role` only |

## Medium fixes applied

| # | Fix |
|---|-----|
| M4 | `mark_link_check_result` and `claim_next_link_check_item` revoked from `PUBLIC`/`anon`/`authenticated` |
| M5 | Both `place_reseller_api_order` overloads (4-arg and 5-arg) revoked from `PUBLIC`/`anon`/`authenticated` |
| M6 | `telegram-webapp-auth` now rejects initData older than 24h |
| L5 | `customer-checkout` rejects `unitPrice <= 0` (no more free orders if admin misconfigures pricing) |

## New / generated secrets

- `SYNC_SHARED_SECRET` — required header for `sync-from-old*` edge fns
- `ADMIN_LAUNCH_TOKEN_SECRET` — HMAC secret for admin Telegram launch tokens (replaces service-role)
- `CRON_SHARED_SECRET` — bearer token for `bootstrap-email-cron`

## Database objects created/modified

- New atomic RPC `public.create_withdrawal_atomic(uuid, numeric, text, text, text)` (security definer; service_role only)
- Dropped RLS policy `"Customers insert own withdrawals"` on `public.bot_withdrawals`
- Added partial unique index `uq_bot_deposits_txn_hash_live`

## Still to do (lower priority — tracked, not yet applied)

- H5 — Move `customer-checkout` into a single PL/pgSQL `place_customer_order` RPC for full atomicity
- H6 — Stop storing client-supplied amount on pending deposit rows
- H8 — bKash callback HMAC signature verification (bKash currently does not document a signature; rate cap on `dollar_rate_bdt` recommended instead)
- H13 — Failed-attempt counter on `bot-bind-telegram-confirm` codes
- M1, M2, M3, M7-M12, L1-L11 — see audit report
- L11 — Move anon JWT in legacy `sync_from_old_cron.sql` migration to vault

**Status after this round: ~16/23 Critical+High closed. Estimated new security score: 7-8/10 (was 5/10).**
