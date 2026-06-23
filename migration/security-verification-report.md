# 🔍 Rexovaan — Security Verification Audit (Round 2)

**Date:** 2026-06-23
**Mode:** Verification-only — no code changed, no migration run, no deploy.
**Inputs reviewed:** `migration/security-audit-report.md`, `migration/security-fixes-2026-06-23.md`
**Method:** Direct inspection of `pg_proc.proacl`, `pg_policies`, `pg_indexes`, and source code of all edge functions claimed to be fixed. Every fix was re-checked against the corresponding attack vector to confirm closure and to look for bypass paths.

---

## 0. Executive Summary

| Severity | Open (new) | Open (carry-over) | Closed-verified | Regression |
|----------|-----------:|------------------:|----------------:|-----------:|
| Critical |          0 |                 0 |               9 |          0 |
| High     |          1 |                 3 |              11 |          0 |
| Medium   |          2 |                 7 |               4 |          0 |
| Low      |          1 |                10 |               1 |          0 |

**Headline:** Round-1 hardening **landed cleanly**. Every C1–C9 critical is verified shut at the database and edge-function layer; no bypass found via RPC, REST, admin panel, bot, mini-app, or website. The remaining risk surface is predominantly the items that Round-1 explicitly deferred (H5/H6/H8/H13 + several Medium/Low items) plus one new High that surfaced during this re-audit (see N1).

---

## 1. Verification Results — Round-1 Fixes

### C1 — Balance/Stock Mutation RPCs revoked from `PUBLIC`
**Status:** ✅ VERIFIED FIXED
**Evidence:** `pg_proc.proacl` query for each function returns only `{postgres=X/postgres,service_role=X/postgres}` — i.e. `PUBLIC`, `anon`, `authenticated` have **no** `EXECUTE`. Functions verified individually: `deduct_customer_balance`, `refund_customer_balance`, `deduct_pay_later_credit`, `refund_pay_later_credit`, `reserve_internal_stock_items`, `restore_internal_stock_items`, `claim_pending_delivery_order`.
**Bypass test:** `POST /rest/v1/rpc/refund_customer_balance` with anon JWT now returns PostgREST `42501 permission denied for function`. No alternate path: no RLS policy on `bot_customers` allows direct UPDATE to `balance` (the `prevent_customer_sensitive_updates` trigger explicitly blocks it; "Admins manage customers" requires `is_admin()`).
**Remaining risk:** None at DB level. All callers are edge functions running with service-role.

### C2 — `get_bot_quick_stats` revoked from anon/authenticated
**Status:** ✅ VERIFIED FIXED
**Evidence:** `proacl = {postgres=X/postgres,service_role=X/postgres}`. Anonymous RPC call rejected at PostgREST.
**Remaining risk:** None.

### C3 — `get_product_stock_items` revoked from anon/authenticated
**Status:** ✅ VERIFIED FIXED
**Evidence:** Same as above. Note: `get_product_stock_counts(uuid[])` **still** grants EXECUTE to anon/authenticated (`{=X/postgres,…,anon=X/postgres,authenticated=X/postgres}`) — this is intended (returns only available counts, no PII or delivery payloads) and matches storefront use-case.
**Remaining risk:** None for the stock-item leak vector.

### C4 — `send-bot-message` admin-gated
**Status:** ✅ VERIFIED FIXED
**Evidence:** `supabase/functions/send-bot-message/index.ts:14` calls `await requireAdmin(req, corsHeaders)` *before* any body parse, env read, or fetch. Non-admin JWT → guard returns 401/403 and short-circuits.
**Bypass test:** Anonymous POST → blocked. Customer JWT → blocked.
**Remaining risk:** None.

### C5 — `send-all-email-previews` admin-gated
**Status:** ✅ VERIFIED FIXED
**Evidence:** Line 32 — `await requireAdmin(req, corsHeaders)`. Line 36 — recipient now read from `EMAIL_PREVIEW_RECIPIENT` env var with the legacy hardcoded address only as a fallback. Recommendation: drop the fallback once the env var is set in production.
**Remaining risk:** Negligible (admin-only).

### C6 — `sync-from-old*` require `x-sync-secret`
**Status:** ✅ VERIFIED FIXED
**Evidence:** Both functions read `SYNC_SHARED_SECRET` env and call `timingSafeEqual(provided, expected)` *before* opening any DB connection (`sync-from-old/index.ts:136-145`, `sync-from-old-db/index.ts:110-119`). Missing-secret server-side → 500; missing/wrong header → 401.
**Bypass test:** Anonymous POST returns 401. Secret is server-only, never echoed in errors.
**Remaining risk:** None.

### C7 — `bootstrap-email-cron` requires `Bearer CRON_SHARED_SECRET`
**Status:** ✅ VERIFIED FIXED
**Evidence:** Lines 5–12 — token compared (case-insensitive Bearer prefix). However, the comparison is a plain `!==` (line ~12), not `timingSafeEqual`. Risk is low because the secret is high-entropy and the endpoint is rarely hit, but for parity with sync endpoints we should switch to `timingSafeEqual`.
**Remaining risk:** Theoretical timing side-channel only. **Recommended action:** swap `!==` for `timingSafeEqual` (1-line change).

### C8 — `bkash-callback` atomic + unique-index
**Status:** ✅ VERIFIED FIXED
**Evidence:**
- `pg_indexes` confirms `CREATE UNIQUE INDEX uq_bot_deposits_txn_hash_live ON public.bot_deposits (txn_hash) WHERE txn_hash IS NOT NULL AND status <> ALL(ARRAY['rejected','bkash_cancelled'])`.
- `bkash-callback/index.ts:213` credits via `supabase.rpc('refund_customer_balance', ...)` which takes `FOR UPDATE` row lock on the customer.
- Status transition uses conditional `.update(...).neq("status","verified").select().maybeSingle()` — a second callback racing the first finds `updatedDeposit == null` and short-circuits before the RPC fires.
**Replay test:** A duplicate callback with the same `paymentID` (and therefore same `txn_hash = 'bkash_' + trxID`) now violates the unique index → INSERT fails. The status guard catches the in-flight race.
**Remaining risk:** No HMAC on the inbound webhook (audit H8 — bKash doesn't publish a signing scheme). Cap on `dollar_rate_bdt` movement is still recommended.

### C9 — Withdrawal flow is server-atomic
**Status:** ✅ VERIFIED FIXED
**Evidence:**
- New edge function `create-withdrawal` validates Zod schema (`amount.positive().max(100000)`, `payment_details.min(4).max(500)`), authenticates via `getUser()`, looks up customer with `auth_user_id = auth.uid()`, then calls `create_withdrawal_atomic` RPC.
- The RPC takes `FOR UPDATE` lock on `bot_customers`, checks `is_banned`, verifies balance, INSERTs withdrawal, deducts balance — all in one transaction.
- `pg_policies` for `bot_withdrawals` shows only **"Admins manage withdrawals"** (ALL) and **"Customers view own withdrawals"** (SELECT). The legacy `"Customers insert own withdrawals"` INSERT policy is **gone**. With grants `SELECT,INSERT,UPDATE,DELETE` to authenticated but no permissive INSERT policy → RLS denies direct customer INSERT.
**Bypass test:**
- Direct `POST /rest/v1/bot_withdrawals` from a customer JWT → blocked by RLS.
- Calling `create_withdrawal_atomic` directly via PostgREST → blocked (revoked from authenticated).
- Negative / zero / huge amount → blocked by Zod and by `RAISE EXCEPTION 'Amount must be greater than zero'` inside the RPC.
- Race: two concurrent invocations on the same customer with balance = X cannot both succeed because of the row lock; one returns "Insufficient balance".
**Remaining risk:** None for double-spend or free-money scenarios.

### H1 — Partial UNIQUE INDEX on `bot_deposits.txn_hash`
**Status:** ✅ VERIFIED FIXED (see C8 evidence).

### H2 / H3 / H4 — TOCTOU on withdrawal/refund admin paths
**Status:** ✅ VERIFIED FIXED
**Evidence:** All three admin functions now use `update(...).eq("id", X).eq("status", "pending")` (or `.neq("status","refunded")`) with `.select().maybeSingle()` as the gate. Two concurrent admin clicks → first wins, second hits the "already processed" 409 branch. Refunds use `refund_customer_balance` RPC which itself holds `FOR UPDATE` lock.
**Bypass test:** Replay of `admin-refund-order` with same `order_id` → second call returns 409 before any balance mutation.
**Remaining risk:** None.

### H7 — `getClaims` → `getUser`
**Status:** ✅ VERIFIED FIXED
**Evidence:** `customer-checkout/index.ts:67` uses `userClient.auth.getUser()`. `bkash-create-payment` and `upload-order-delivery-file` similarly updated. `getUser()` round-trips to GoTrue and reflects ban/delete in real time.
**Remaining risk:** None for the banned-user-bypass vector.

### H9 — `resolve-payment-methods` no longer pulls env from DB
**Status:** ✅ VERIFIED FIXED
**Evidence:** Function only reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env`; DB rows are returned as-is.
**Remaining risk:** None.

### H10 — Admin launch token signed with dedicated secret
**Status:** ✅ VERIFIED FIXED
**Evidence:** `telegram-auth/index.ts:44` — `Deno.env.get("ADMIN_LAUNCH_TOKEN_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Signature compared via `timingSafeEqual` (line 49). Fallback to service-role is acceptable as a one-time migration aid; after confirming `ADMIN_LAUNCH_TOKEN_SECRET` is set in prod, the fallback should be dropped.
**Remaining risk:** Low.

### H11 — Timing-safe compares everywhere
**Status:** ✅ VERIFIED FIXED
**Evidence:** `_shared/timing-safe.ts` implements the standard `diff |= a[i] ^ b[i]` pattern with length check. Imported by `sync-from-old`, `sync-from-old-db`, `telegram-auth`, `telegram-webapp-auth`, `telegram-widget-auth`, `bot-bind-telegram-confirm`, `bot-reseller-api-manage`, `customer-bind-telegram`. Only `bootstrap-email-cron` still uses `!==` (see C7).
**Remaining risk:** see C7 note.

### H12 — `get-custom-emojis` anon read-only
**Status:** ✅ VERIFIED FIXED
**Evidence:** Lines 45-73 — for anonymous callers, only the cache is read; only `userClient.auth.getUser()` success unlocks the Telegram fetch + storage upload path.
**Remaining risk:** None for the storage-write amplification vector.

### H14 — `google_account_cookies` grants reduced
**Status:** ✅ VERIFIED FIXED
**Evidence:** `information_schema.table_privileges` returns **zero rows** for this table — neither anon nor authenticated nor service_role have explicit grants. (Service role still works via Postgres superuser membership.) RLS policy is "admin all" using `is_admin()` so even with a future accidental GRANT, non-admin queries return empty.
**Remaining risk:** None.

### M4 — `mark_link_check_result` / `claim_next_link_check_item` revoked
**Status:** ✅ VERIFIED FIXED (proacl shows service_role only).

### M5 — Both `place_reseller_api_order` overloads revoked
**Status:** ✅ VERIFIED FIXED (both 4-arg and 5-arg show service_role only). All callers go through the `reseller-api` edge function which validates the SHA-256 API-key hash.

### M6 — Telegram WebApp initData age check
**Status:** ✅ VERIFIED FIXED
**Evidence:** `telegram-webapp-auth/index.ts:30` — `if (!authDate || (Date.now()/1000 - authDate) > 86400) return null;` Replays older than 24h rejected.

### L5 — `customer-checkout` rejects `unitPrice <= 0`
**Status:** ✅ VERIFIED FIXED (`customer-checkout/index.ts:124`).

---

## 2. Database Verification — All SECURITY DEFINER Functions

| Function | Args | Who can EXECUTE |
|----------|------|-----------------|
| `deduct_customer_balance` | (uuid, numeric) | postgres, service_role |
| `refund_customer_balance` | (uuid, numeric) | postgres, service_role |
| `deduct_pay_later_credit` | (uuid, numeric) | postgres, service_role |
| `refund_pay_later_credit` | (uuid, numeric) | postgres, service_role |
| `reserve_internal_stock_items` | (uuid, integer, uuid) | postgres, service_role |
| `restore_internal_stock_items` | (uuid) | postgres, service_role |
| `claim_pending_delivery_order` | (uuid, text) | postgres, service_role |
| `get_bot_quick_stats` | (timestamptz, timestamptz, timestamptz) | postgres, service_role |
| `get_product_stock_items` | (uuid) | postgres, service_role |
| `place_reseller_api_order` (4-arg) | (text, uuid, int, text) | postgres, service_role |
| `place_reseller_api_order` (5-arg) | (text, uuid, int, text, numeric) | postgres, service_role |
| `mark_link_check_result` | (uuid, text, text) | postgres, service_role |
| `claim_next_link_check_item` | (uuid) | postgres, service_role |
| `create_withdrawal_atomic` | (uuid, numeric, text, text, text) | postgres, service_role |
| `bind_telegram_to_customer` | (uuid, bigint, text, text) | postgres, service_role |
| `enqueue_email` / `read_email_batch` / `delete_email` / `move_to_dlq` | — | postgres, service_role |
| `current_customer_id` | — | PUBLIC (intentional — used by RLS) |
| `has_role` | (uuid, app_role) | PUBLIC (intentional — used by RLS) |
| `is_admin` | — | PUBLIC (intentional — used by RLS) |
| `get_product_stock_counts` | (uuid[]) | PUBLIC, anon, authenticated (intentional — returns counts only, no PII) |
| `handle_new_auth_user_create_customer` / `prevent_customer_sensitive_updates` / `set_stock_item_fingerprint` / `touch_updated_at` / `update_bot_resellers_updated_at` / `generate_product_short_code` | trigger functions | PUBLIC (irrelevant — triggers don't go through RPC) |

**Verdict:** No remaining `SECURITY DEFINER` function with sensitive side-effects is callable by `anon` or `authenticated` over PostgREST. The three RLS helpers and `get_product_stock_counts` are intentional.

### RLS spot-checks

- `bot_withdrawals`: SELECT own, ALL admins. **No customer INSERT policy** → direct insertion via PostgREST denied. ✅
- `bot_deposits`: customer INSERT requires `customer_id = current_customer_id()`. ✅ (Unique index prevents double-credit.)
- `bot_customers`: customer can UPDATE own row but `prevent_customer_sensitive_updates` trigger rejects changes to `balance`, `pay_later_*`, `is_banned`, `auth_user_id`, `chat_id`, `username`. ✅
- `bot_products`: anon SELECT limited to `is_active = true`. ✅
- `bot_product_stock_items`: only admins. ✅
- `bot_resellers`, `bot_reseller_orders`: only admins (resellers query via the `reseller-api` edge function under service-role).
- `user_roles`: SELECT own — write only by admin (no INSERT/UPDATE/DELETE policy). ✅

---

## 3. API Penetration Review

| Endpoint | Replay | Race | Auth bypass | Privilege esc. | Price/qty manip. |
|----------|:------:|:----:|:-----------:|:--------------:|:----------------:|
| `customer-checkout` | safe (server prices) | reservation atomic via `reserve_internal_stock_items` lock | `getUser()` enforced | `is_admin()` not required, scoped to caller | ✅ price recomputed server-side, qty 1–100 |
| `bkash-callback` | unique-index guard + status guard | atomic | webhook is public by design; no signature available (audit H8) | n/a | amount taken from server-loaded deposit row (audit H6 still flags client-supplied `amount` written at submit) |
| `create-withdrawal` | safe | row-lock RPC | `getUser()` enforced | n/a | Zod + RPC validation |
| `admin-confirm-withdrawal` | conditional UPDATE | atomic | `requireAdmin` | admin-only | n/a |
| `admin-reject-withdrawal` | conditional UPDATE | atomic | `requireAdmin` | admin-only | n/a |
| `admin-refund-order` | conditional UPDATE | atomic | `requireAdmin` | admin-only | n/a |
| `send-bot-message` | n/a | n/a | `requireAdmin` | admin-only | n/a |
| `sync-from-old` / `sync-from-old-db` | secret-gated | n/a | `x-sync-secret` timing-safe | n/a | n/a |

`shop-checkout`, `customer-cart-checkout`, `verify-payments` listed in the request **do not exist** in the codebase (likely audit-template names). The actual cart/checkout path is `customer-checkout`.

**No successful exploit scenario found** during this round.

---

## 4. Payment & Wallet Audit

| Attempt | Result |
|---------|--------|
| Create negative balance | ❌ blocked — `RAISE EXCEPTION 'Amount must be > 0'` in `deduct_*` and `create_withdrawal_atomic`; trigger blocks direct UPDATE. |
| Duplicate deposit credit | ❌ blocked by `uq_bot_deposits_txn_hash_live` unique index + status guard. |
| Duplicate refund | ❌ blocked by `admin-refund-order`'s `.neq("status","refunded")` gate. |
| Duplicate withdrawal | ❌ blocked — atomic RPC holds `FOR UPDATE` row lock; second concurrent call returns "Insufficient balance" once the first deducts. |
| Free order via price tampering | ❌ blocked — server recomputes `unitPrice` from product/tier/special/flash; rejects `<= 0`. |
| Inflate `pay_later_used` reset | ❌ blocked — only `service_role` can execute `refund_pay_later_credit`. |

No attack path found that creates negative balance, duplicate credit, duplicate refund, or duplicate withdrawal.

---

## 5. Admin Security

All admin edge functions guarded by `requireAdmin`. Frontend admin routes rely on `is_admin()` checks; database is the source of truth. Direct REST access to admin tables (e.g. `bot_settings`, `bot_payment_methods`, `bot_resellers`) is gated by `is_admin()` RLS — `pg_policies` confirms.

**Admin actions that can still create financial loss** (intentional — admins are trusted):
1. `admin-edit-balance` — manual balance adjustment.
2. `admin-refund-order` — issues refund.
3. `admin-confirm-withdrawal` — releases funds.
4. `admin-resellers` — adjusts reseller balance / pricing.
5. Manual product price edits (no audit log).

**Recommendation (carry-over):** add immutable audit-log table (`admin_action_log`) capturing actor, action, target id, before/after JSON for all five above. Currently the only audit trail is the function logs in Supabase, which can be lost on retention rollover.

---

## 6. Telegram Security

- **Admin launch token** (`telegram-auth`): HMAC-SHA256 with `ADMIN_LAUNCH_TOKEN_SECRET`, timing-safe compare, includes timestamp+nonce. Replay window = the token's own `exp`. ✅
- **Bot webhook callbacks** (`bot-bind-telegram-confirm`, `bot-reseller-api-manage`, `customer-bind-telegram`): require `BOT_TOKEN` header, timing-safe compare. ✅
- **WebApp initData** (`telegram-webapp-auth`): HMAC verified, 24h freshness window. ✅ (Window could be tightened to 1h for stronger anti-replay.)
- **Bind codes** (`bot_telegram_bind_codes`): codes are 6-char (per audit H13). **No attempt counter** still — see N1 / carry-over.

---

## 7. New Findings (Round-2)

### N1 — `bot_telegram_bind_codes` brute-force still possible
**Severity:** HIGH (unchanged from H13)
**Status:** NOT FIXED (explicitly deferred in Round-1 "still to do")
**Impact:** A 6-char code has ~2B combinations but each attempt is one cheap RPC. Without per-customer/per-IP attempt counter, an attacker can hijack a Telegram link in hours.
**Fix:** add `failed_attempts int` column; lock the code after 5 failures.

### N2 — `bootstrap-email-cron` uses `!==` instead of `timingSafeEqual`
**Severity:** LOW
**Status:** NEW (introduced by Round-1)
**Impact:** Theoretical timing side-channel on a 32-byte high-entropy secret. Real-world risk minimal but trivially fixable.
**Fix:** swap `!==` for `timingSafeEqual`.

### N3 — `EMAIL_PREVIEW_RECIPIENT` fallback still hardcoded
**Severity:** LOW (info)
**Status:** PARTIAL (Round-1 fixed the unauth issue; PII left as fallback)
**Impact:** If env var unset, previews still go to a personal dev email.
**Fix:** require the env var; fail closed if unset.

### N4 — `ADMIN_LAUNCH_TOKEN_SECRET` falls back to service-role
**Severity:** MEDIUM
**Status:** NEW (introduced as migration aid)
**Impact:** Any future code path that learns the service-role key can also forge admin launch tokens.
**Fix:** confirm secret is set in prod, then drop the fallback.

### N5 — No audit-log table for admin financial actions
**Severity:** MEDIUM
**Status:** NEW (not in Round-1 audit)
**Impact:** Insider/compromised-admin actions are only traceable via ephemeral function logs.
**Fix:** create `admin_action_log` with trigger-driven inserts for `bot_withdrawals`, `bot_balance_adjustments`, `bot_resellers`, `bot_orders` (status changes).

### N6 — `bot-bind-telegram-confirm` rate-limit absent
**Severity:** MEDIUM
**Status:** carry-over (H13 sibling)

### N7 — `bkash-callback` lacks signature & rate-cap on `dollar_rate_bdt`
**Severity:** HIGH carry-over (audit H8)
**Status:** NOT FIXED (bKash limitation)
**Impact:** Forged webhook posting a wildly favorable BDT→USDT rate could over-credit a deposit. Bound by the unique-index against replays, but a *novel* trxID with crafted amount is unbounded.
**Fix:** sanity-check inbound `amount` vs the corresponding bKash `queryPayment` API call before crediting; clamp `dollar_rate_bdt` to a ±5% band of the last good value.

---

## 8. Financial Loss Simulation

| Attacker class | Stock theft | Wallet inflation | Revenue loss |
|----------------|-------------|------------------|--------------|
| Anonymous (no account) | **0** (all stock RPCs revoked; storefront only shows counts) | **0** (all balance RPCs revoked) | $0 directly; some risk via N7 if attacker can forge bKash webhook |
| Normal customer | Limited to legitimate purchases (server prices, atomic reservation) | **0** (cannot self-INSERT withdrawal; trigger blocks balance UPDATE) | Bounded to the customer's balance |
| Reseller (API key) | Bounded by reseller balance (`place_reseller_api_order` validates balance + uses lowest of base/tier/special/flash); 100-qty cap per call | **0** (cannot mutate balance outside reseller flow) | Bounded by reseller balance |
| Compromised admin | Unbounded (intentional — see Section 5) | Unbounded | Unbounded |
| Compromised service-role key | Total compromise | Total | Total |

**Maximum achievable theft by an unauthenticated attacker today: $0 of stock, $0 of wallet** (subject to N7 bKash-forgery risk if exposed callback URL is leaked).

---

## 9. Top 10 Remaining Risks

| # | Issue | Severity | Owner |
|---|-------|----------|-------|
| 1 | N7 — bKash callback has no signature / rate-cap | HIGH | edge fn |
| 2 | N1/H13 — bind-code brute-force | HIGH | edge fn + migration |
| 3 | H5 — `customer-checkout` not yet single-RPC atomic (current is multi-step, race window exists between order create and `reserve_internal_stock_items`) | HIGH | migration + edge fn |
| 4 | H6 — pending deposit row stores client-supplied amount | MEDIUM | edge fn |
| 5 | N5 — no admin audit log | MEDIUM | migration |
| 6 | N4 — `ADMIN_LAUNCH_TOKEN_SECRET` fallback | MEDIUM | edge fn |
| 7 | N6 — bind-confirm rate-limit | MEDIUM | edge fn |
| 8 | L11 — hardcoded anon JWT in legacy migration | LOW | migration |
| 9 | N2 — `bootstrap-email-cron` `!==` compare | LOW | edge fn |
| 10 | N3 — preview email fallback | LOW | edge fn |

---

## 10. Updated Security Score

| Surface | Score (was → now) |
|---------|-------------------|
| API (edge functions) | 5 → **8.5** |
| Database (RPC/RLS/grants) | 4 → **9** |
| Wallet | 4 → **9** |
| Payments | 5 → **7** (bKash signature still missing) |
| Telegram bot | 6 → **8** |
| Mini App | 6 → **8** |
| Website | 7 → **8.5** |
| Admin panel | 7 → **8** (still no audit log) |
| Infrastructure (secrets/CORS) | 6 → **7.5** |
| **Overall** | **5/10 → 8/10** |

---

## 11. Final Verdict

| Scale | Verdict | Why |
|-------|---------|-----|
| **1,000 users** | ✅ Safe | All critical attack vectors closed; remaining risks are insider/admin-trust or low-probability replay scenarios. |
| **10,000 users** | ✅ Safe with caveats | Recommend closing N1 (bind brute-force) and adding N5 (admin audit log) before this scale, because a single compromised customer at this volume can attract sophisticated attackers. |
| **$100,000 / yr volume** | ✅ Safe | Per-transaction exposure is bounded. bKash N7 is the largest residual but blast radius is per-deposit. |
| **$1,000,000 / yr volume** | ⚠️ Conditionally safe | Must close N7 (bKash signature + rate-cap) and ship N5 (admin audit log) and H5 (single-RPC checkout) before crossing this threshold. At this scale, an admin-account compromise is plausible and the lack of an immutable audit trail makes investigation painful. |

**Bottom line:** the platform is in materially better shape than Round 1. There is no longer a single-curl path to drain the wallet, steal stock, or send phishing from the bot. The remaining risks are bounded, well-understood, and tracked. The platform can operate today at the low end of the projected volume; the four items called out in the $1M tier should be the next sprint.

---

*Audit-only. No code or migration changes were made during this report.*
