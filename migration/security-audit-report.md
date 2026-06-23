# 🔐 Rexovaan / Vexoran — Deep Security Audit Report

**Audit date:** 2026-06-23
**Scope:** Frontend, Admin Panel, Telegram Bot, Mini App, Edge Functions, Database, Storage, Payment / Wallet / Order / Delivery, Infrastructure
**Method:** Evidence-based code-level review of `src/`, `supabase/functions/`, all `supabase/migrations/*.sql`, runtime logs, RPC bodies, RLS policies, GRANTs, edge function configs.
**Mode:** Audit-only. No code modified, no migration run, no deploy.

---

## 0. Executive Summary

| Severity | Count | Quick description |
|----------|------:|-------------------|
| 🔴 **CRITICAL** | **9** | Unauthenticated balance/stock RPCs, unauth bot-message blast, sync endpoint open, deposit race double-credit, env-var exfiltration, `get_bot_quick_stats` to anon, `get_product_stock_items` to anon, `send-all-email-previews` open, withdrawal can be free money |
| 🟠 **HIGH** | **14** | TOCTOU on confirm/reject withdrawal & refund, missing `UNIQUE(txn_hash)`, getClaims-not-getUser in payment paths, no bKash signature, non-timing-safe token compares, bind-code brute-force, broad GRANTs on `google_account_cookies`, hardcoded anon JWT in migration, customer-checkout non-atomic, get-custom-emojis open, etc. |
| 🟡 **MEDIUM** | **12** | Admin tabs depend on RLS only, listUsers() DoS, no auth_date check in webapp-auth, link-check RPCs callable by any user, place_reseller_api_order 5-arg overload not revoked, weak password rules, bot_notification_settings DELETE gap, etc. |
| 🟢 **LOW / INFO** | **11** | CORS `*` everywhere, hardcoded developer email, log noise, missing reusable AdminRoute, storage MIME-type check missing, etc. |

**Headline:** the platform's foundation is decent (atomic RPCs exist; admin edge functions correctly use `requireAdmin`; frontend reads are scoped) — but **the perimeter is leaky in many places that a casual attacker can hit with curl alone**. Several findings allow direct financial damage without any account, without admin access, and without any social engineering. The recent `admin-resellers` $715 incident is **not** an isolated bug; it is symptomatic of a recurring pattern: RPCs and edge functions that were created without explicit `REVOKE EXECUTE FROM PUBLIC` or without a caller-auth check.

---

## 1. Critical Findings (must fix before next launch / before scaling traffic)

---

### C1 — Balance/Stock Mutation RPCs Callable by `anon` (no GRANT/REVOKE)
**Component:** Database (SECURITY DEFINER functions)
**Affected:** `deduct_customer_balance`, `refund_customer_balance`, `deduct_pay_later_credit`, `refund_pay_later_credit`, `claim_pending_delivery_order`, `reserve_internal_stock_items`, `restore_internal_stock_items`
**Files:** `supabase/migrations/*.sql` — these functions are defined `SECURITY DEFINER` but **no `REVOKE EXECUTE FROM PUBLIC`** is present in any migration. Postgres grants EXECUTE to `PUBLIC` by default; PostgREST exposes them at `/rest/v1/rpc/<fn>`.
**Attack:**
```
curl -X POST https://eygkdpfjrjwwbiackfpr.supabase.co/rest/v1/rpc/refund_customer_balance \
  -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"_customer_id":"<ANY-UUID>","_amount":999999}'
```
**Impact:** Drain or inflate any customer's balance. Mark any pending order as any status. Consume / restore all stock without paying. **This is the highest-impact bug in the entire system.**
**Fix:** `REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM PUBLIC, anon, authenticated;` for each, then `GRANT EXECUTE … TO service_role;`. All callers should be edge functions that already validate the caller.

---

### C2 — `get_bot_quick_stats` Granted to `anon` (full revenue + buyer PII leak)
**Component:** Database
**File:** migration `20260526170719_*.sql` — `GRANT EXECUTE ON FUNCTION public.get_bot_quick_stats(...) TO authenticated, service_role, anon;`
**Attack:** Anonymous `POST /rest/v1/rpc/get_bot_quick_stats` returns total/today/week/month revenue, top-5 buyers (first_name, username, chat_id), top-5 selling products.
**Impact:** Full business-intelligence leak (revenue + customer identifiers). Competitors and scammers benefit.
**Fix:** Revoke from anon/authenticated; only call from an admin edge function.

---

### C3 — `get_product_stock_items` Granted to `anon` (raw delivery data leak)
**Component:** Database
**File:** migration grants `EXECUTE … TO anon, authenticated`. Function returns `bot_product_stock_items.data` JSONB (license keys, Google account cookies refs, etc.) for any product_id with no status filter.
**Attack:** `POST /rest/v1/rpc/get_product_stock_items` with any product_id → entire deliverable inventory, even unsold items.
**Impact:** Steal every digital good. Catastrophic.
**Fix:** Revoke from anon/authenticated; gate behind admin edge function.

---

### C4 — `send-bot-message` Edge Function Has Zero Authentication
**Component:** Edge Function
**File:** `supabase/functions/send-bot-message/index.ts:10-40`
**Attack:** `POST /functions/v1/send-bot-message` with `{chat_id, text}` → bot delivers arbitrary HTML message from your bot to **any chat the bot can reach** (any customer, any group).
**Impact:** Mass phishing from your own bot ("your account is banned, send 1 BTC to recover"). Brand-destroying.
**Fix:** Add `requireAdmin` at the top, same pattern as `broadcast-message`.

---

### C5 — `send-all-email-previews` Open Endpoint
**Component:** Edge Function
**File:** `supabase/functions/send-all-email-previews/index.ts:38`
**Attack:** Anyone POSTs → sends every email template preview to hardcoded `mostaqahmmeds@gmail.com`. Mailgun quota burn + dev email leaked.
**Fix:** Add admin guard; move recipient to env var.

---

### C6 — `sync-from-old` and `sync-from-old-db` Open Endpoints
**Component:** Edge Function
**Files:** `supabase/functions/sync-from-old/index.ts:58`, `supabase/functions/sync-from-old-db/index.ts:105`
**Issue:** `sync-from-old-db` declares `x-sync-secret` in CORS headers but **never validates it**.
**Attack:** Any caller triggers a full data re-sync from the old DB, potentially overwriting balances, orders, user_roles with stale snapshots.
**Impact:** Data corruption / DoS / silent rollback.
**Fix:** Read and timing-safe-compare `x-sync-secret` against an env var before doing anything.

---

### C7 — `bootstrap-email-cron` Open Endpoint with `verify_jwt = false`
**Component:** Edge Function
**File:** `supabase/functions/bootstrap-email-cron/index.ts`, `supabase/config.toml`
**Attack:** Anyone POSTs → writes service-role key to `vault.secrets`, drops/recreates `pg_cron` job. An attacker controlling the request body could redirect cron jobs.
**Fix:** Require a `CRON_SECRET` bearer or flip to `verify_jwt = true`.

---

### C8 — `bkash-callback` Balance Update Is Not Atomic → Race-Based Double-Credit
**Component:** Payment / Edge Function
**File:** `supabase/functions/bkash-callback/index.ts:195-218`
**Issue:** Status flip (`UPDATE … neq("status","verified")`) and balance increment (`SELECT balance` then `UPDATE balance = balance + amount`) are two separate non-transactional calls. No `UNIQUE(txn_hash)` constraint exists.
**Attack:** Replay or concurrent callback delivery → both pass the `.neq` guard, both read the same stale balance → final balance reflects two credits.
**Impact:** Full deposit amount × 2 per exploit. Repeatable.
**Fix:** Use `refund_customer_balance` RPC (atomic `FOR UPDATE`) for the credit; add `UNIQUE(txn_hash)` on `bot_deposits` as a hard idempotency gate.

---

### C9 — Customer Withdrawal Is a 2-Step Client Operation → Free Money on Network Drop
**Component:** Frontend + RPC
**File:** `src/pages/customer/Withdraw.tsx:29-38`
```ts
await supabase.from('bot_withdrawals').insert({ customer_id, amount, … }); // step 1
await supabase.rpc('deduct_customer_balance', { _customer_id, _amount }); // step 2 (separate call)
```
**Attack:** User submits → withdrawal row created → close browser tab / kill network before step 2 fires → admin pays out, balance never decremented → repeat.
Combined with C1, an attacker doesn't even need to be the customer — they can pass any `_customer_id`.
**Impact:** Full withdrawal amount per exploit, repeatable, undetectable in audit log.
**Fix:** Replace with a single edge function `create-withdrawal` that wraps both ops in one PL/pgSQL transaction with `FOR UPDATE` and verifies `auth.uid()` ownership.

---

## 2. High Findings

---

### H1 — Missing `UNIQUE(txn_hash)` on `bot_deposits` → TxID replay
**Files:** all `bot_deposits` migrations + `submit-deposit-verification/index.ts:417-424`. TOCTOU between dup-check and insert → double credit possible.
**Fix:** `ALTER TABLE bot_deposits ADD CONSTRAINT uq_deposits_txn_hash UNIQUE (txn_hash);`

### H2 — `admin-confirm-withdrawal` TOCTOU → Double Pay
**File:** `supabase/functions/admin-confirm-withdrawal/index.ts:37-51`. Two concurrent admin tabs both pass `status === "pending"` check.
**Fix:** `UPDATE bot_withdrawals SET status='completed' WHERE id=? AND status='pending' RETURNING amount` — only proceed if rowCount = 1.

### H3 — `admin-reject-withdrawal` TOCTOU → Double Refund
**File:** `admin-reject-withdrawal/index.ts:37-53`. Refund happens before status update; status update may fail; re-reject possible.
**Fix:** Same atomic conditional update pattern as H2.

### H4 — `admin-refund-order` TOCTOU → Double Balance Credit
**File:** `admin-refund-order/index.ts:47-76`. Status guard, restore stock, refund balance, then update status — all separate calls.
**Fix:** Atomic `UPDATE bot_orders SET status='refunded' WHERE id=? AND status != 'refunded' RETURNING id` as the gate.

### H5 — `customer-checkout` Marks Order `completed` Before Balance Deducted
**File:** `customer-checkout/index.ts:137-168`. If `restore_internal_stock_items` rollback silently fails, stock is permanently `sold` with no order and no revenue.
**Fix:** Move whole flow into a single PL/pgSQL `place_customer_order` RPC analogous to `place_reseller_api_order`.

### H6 — `submit-deposit-verification` Stores Client-Supplied Amount in Pending Deposit
**File:** `submit-deposit-verification/index.ts:407,534`. Admin reviewing the pending row sees attacker-controlled amount.
**Fix:** For fallback path, store `0`/`null`; require admin to enter real amount or look it up on-chain before approval.

### H7 — `customer-checkout`, `bkash-create-payment`, `upload-order-delivery-file` use `getClaims` instead of `getUser`
**Files:** `customer-checkout/index.ts:46`, `bkash-create-payment/index.ts:46`, `upload-order-delivery-file/index.ts:26`. `getClaims` only decodes JWT locally — banned/deleted users with unexpired tokens still pass.
**Fix:** Replace with `await supabase.auth.getUser()` (which calls the auth server) — pattern already used in `_shared/require-admin.ts`.

### H8 — `bkash-callback` Has No Signature Verification + Trusts bKash-Reported Amount
**File:** `bkash-callback/index.ts:54,134`. Anyone can hit the URL with a guessed/known `paymentID`; final USDT amount derives from `execData.amount` divided by `bot_settings.dollar_rate_bdt` (admin-editable) → an admin XSS / compromised admin can deflate the rate to credit huge amounts.
**Fix:** Implement bKash HMAC verification on callback; move `dollar_rate_bdt` to env or apply min/max bounds.

### H9 — `resolve-payment-methods` Env-Var Exfiltration
**File:** `resolve-payment-methods/index.ts:17-19`. Unauth endpoint resolves DB string to `Deno.env.get(value)`. If an admin (or DB compromise) sets `payment_details = "SUPABASE_SERVICE_ROLE_KEY"`, the service-role key leaks to the public.
**Fix:** Remove the env-var resolution; resolve once at config time and store the final value.

### H10 — `telegram-auth` Uses Service-Role Key as HMAC Secret
**File:** `telegram-auth/index.ts:46`. Any leak of service-role key (via H9, logs, etc.) enables forging admin launch tokens → mint real admin Supabase session.
**Fix:** Use a dedicated `ADMIN_LAUNCH_TOKEN_SECRET`.

### H11 — Non-Timing-Safe Token / HMAC Comparisons Everywhere
**Files:** `bot-bind-telegram-confirm:20`, `bot-reseller-api-manage:62`, `telegram-auth:47`, `telegram-webapp-auth:27`, `telegram-widget-auth:42`, `customer-bind-telegram:76`. All use `!==`.
**Fix:** Extract `timingSafeEqual` from `process-email-queue/index.ts:55` into `_shared/` and reuse everywhere.

### H12 — `get-custom-emojis` Open Endpoint (storage-write amplification)
**File:** `get-custom-emojis/index.ts:33`. Unauth caller triggers up to 200 Telegram API calls + 200 storage uploads per request.
**Fix:** Require auth (at minimum `getUser`) or admin.

### H13 — Bind-Code Brute-Force on `bot-bind-telegram-confirm`
**File:** `bot-bind-telegram-confirm/index.ts:33-42`. 32^6 ≈ 1B code space, 10-min TTL, no failed-attempt counter, lookup by plaintext code.
**Fix:** Add `failed_attempts` column with lock-out at 10; consider hashing codes at rest.

### H14 — `google_account_cookies` Table Has Over-Broad `GRANT … TO authenticated`
**File:** migrations. Contains live Google session cookies (most sensitive data in DB). RLS correctly restricts to admin, but the table-level grant is the last line of defense if RLS misconfigures.
**Fix:** `REVOKE ALL FROM authenticated; GRANT ALL TO service_role;` — admin panel should reach via service-role edge function only.

---

## 3. Medium Findings

| # | Component | File | Issue | Fix |
|---|-----------|------|-------|-----|
| M1 | Edge Function | `admin-verify-deposit/index.ts:109-148, 206, 329` | Admin-supplied amount, no `bot_balance_adjustments` audit row, non-atomic balance update | Use `refund_customer_balance` RPC; insert audit row |
| M2 | DB | `prevent_customer_sensitive_updates` trigger | No-op for service-role; trust depends entirely on edge-function hygiene | Document; audit every service-role write |
| M3 | DB | `user_roles` | No `customer` row created on signup → `has_role(uid,'customer')` always false | Extend `handle_new_auth_user_create_customer` trigger |
| M4 | DB | `mark_link_check_result`, `claim_next_link_check_item` | Callable by any authenticated user → can mark stock invalid or hijack jobs | REVOKE EXECUTE from PUBLIC/anon/authenticated |
| M5 | DB | `place_reseller_api_order(text,uuid,int,text,numeric)` 5-arg overload | Not covered by earlier REVOKE on 4-arg signature | Revoke the new overload |
| M6 | Edge Function | `telegram-webapp-auth/index.ts:27` | No `auth_date` freshness check → initData replay valid forever | Add `> 86400` check like widget-auth |
| M7 | Edge Function | `telegram-webapp-auth`, `telegram-widget-auth`, `customer-bind-email` | `listUsers()` full dump on first-login path | Use `getUserByEmail` |
| M8 | Edge Function | `admin-edit-balance/index.ts:22-23` | No upper/lower bound on `new_balance` | Cap to ±$1M for defense-in-depth |
| M9 | Frontend | `Withdraw.tsx:29` | `bot_withdrawals.insert` with client-supplied `customer_id` — relies on RLS | Verify RLS WITH CHECK; move to edge function |
| M10 | Frontend | Multiple admin tabs | Direct writes to `bot_products`, `bot_settings`, `bot_customer_pricing`, etc. depend entirely on RLS quality | Verify each table's RLS uses `is_admin()` |
| M11 | Auth | `Signup.tsx:59` | 6-char password minimum only, no complexity, no CAPTCHA | Enable Supabase CAPTCHA + frontend complexity check |
| M12 | Frontend | `App.tsx:58` | Admin route guard is one-off in `Index.tsx`, not reusable `<AdminRoute>` | Extract reusable wrapper |

---

## 4. Low / Informational

| # | Component | File | Note |
|---|-----------|------|------|
| L1 | Edge Function | All | CORS `*` everywhere; acceptable for public APIs, but audit |
| L2 | Edge Function | `send-all-email-previews:22` | Hardcoded dev email |
| L3 | Edge Function | `bkash-callback:55, 85` | Logs full payment response payloads |
| L4 | Edge Function | `auth-email-hook` | Returns 500 instead of 401 if `SEND_EMAIL_HOOK_SECRET` unset — leaks config state |
| L5 | Edge Function | `customer-checkout:123`, `reseller-api:197` | Allows `unitPrice = 0` (filter is `>= 0`) — admin error → free orders |
| L6 | Edge Function | `upload-order-delivery-file:51-63` | Uploads to public `site-assets` bucket with guessable path → enumeration possible |
| L7 | DB | `bot_notification_settings` | No DELETE policy for customers |
| L8 | Storage | `instruction-media`, `site-assets` policies | No file-type / MIME / size enforcement at SQL level |
| L9 | Frontend | `Deposit.tsx:195`, `Login.tsx:28`, `Signup.tsx:36` | `navigate(next)` from URL param — bounded by React Router so no true open redirect, but allows post-login redirect to any internal path |
| L10 | Frontend | `TelegramRichText.tsx` | Allowlist parser, safe — admin authored, no XSS path |
| L11 | DB | Anon JWT hardcoded in migration `20260607202758_sync_from_old_cron.sql:2557` | Use vault instead |

---

## 5. Telegram Bot / Mini App / Webhook

- **No webhook endpoint** in the repo (`rg setWebhook|callback_query|update.message supabase/ src/` = 0 results). The bot is operated via polling or the Lovable Telegram connector gateway — out-of-repo runtime. The admin command authorization (`/api`, `/balance`, callback IDOR) **cannot be audited from this codebase**. Recommend a separate audit of that runtime.
- All Telegram-auth-receiving edge functions correctly verify the HMAC with `BOT_TOKEN`. Findings H10, H11, M6, M7 apply.
- API-key issuance (`/api` Telegram command, handled by `bot-reseller-api-manage`) returns the plaintext key in the response. The bot is responsible for showing it to the user. This is the **most likely original leak vector** for the recent $715 incident — the plaintext key sits in Telegram chat history. Consider: one-time reveal + auto-delete after 60 s in the bot's UX layer.

---

## 6. Storage Buckets

| Bucket | Public | RLS quality | Risk |
|--------|--------|-------------|------|
| `instruction-media` | Yes | Admin-only write | No MIME/type/size check |
| `custom-emojis` | Yes | Open via `get-custom-emojis` (H12) | Storage-write amplification |
| `site-assets` | Yes | Admin write | Order deliveries uploaded here (L6) → enumeration leak |
| `profile-uploads` | No | Per-user folder enforced (`storage.foldername(name)[1] = auth.uid()::text`) ✅ | Good |

---

## 7. Secrets & Infrastructure

- **No service-role key found in `src/`** ✅
- **No hardcoded `BOT_TOKEN` / `sk_*` / `rsk_live_*` in `src/`** ✅
- Anon JWT in `src/integrations/supabase/client.ts` — by design, fine
- Anon JWT in DB migration (`L11`) — should be vaulted
- `bootstrap-email-cron` writes service-role key into `vault.secrets` ✓ — but the function itself is open (C7)
- No runtime rate limiting on any edge function
- No replay-detection beyond deposit duplicate-check
- No alerting system for anomalous spend / order velocity (the $715 incident took 9 minutes to drain and no alert fired)

---

## 8. Financial Risk Analysis

| Risk type | Maximum single-incident loss | Detection time today | Detection time with fixes |
|-----------|------------------------------|---------------------|--------------------------|
| Balance inflation (C1, C2 indirectly) | **Unlimited** — `refund_customer_balance` accepts any amount | None (no audit row on this path) | Immediate (audit + rate limit) |
| Stock theft (C1, C3) | **Entire inventory** | Discovered on next stock check | Immediate |
| Deposit double-credit (C8, H1) | 2× per real deposit | Manual reconciliation only | Immediate (UNIQUE constraint) |
| Withdrawal free-money (C9) | Full withdrawal amount × repeat | Never (looks legitimate) | Immediate (atomic flow) |
| Withdrawal double-pay (H2) | 2× per pending withdrawal | Treasury reconciliation | Immediate |
| Refund double-credit (H4) | 2× per refunded order | Manual reconciliation | Immediate |
| Bot phishing (C4) | Brand & customer trust | Customer complaints | Immediate (auth) |
| Service-role leak (H9 → H10) | **System-wide compromise** | Possibly never | Removed by fix |

---

## 9. Top 20 To Fix First (prioritized by business impact)

1. **C1** — REVOKE EXECUTE on `deduct_customer_balance`, `refund_customer_balance`, `deduct_pay_later_credit`, `refund_pay_later_credit`, `claim_pending_delivery_order`, `reserve_internal_stock_items`, `restore_internal_stock_items` from PUBLIC.
2. **C9** — Move withdrawal create+deduct into a single edge function (atomic).
3. **C8** — Use `refund_customer_balance` RPC inside `bkash-callback`; add `UNIQUE(txn_hash)`.
4. **C4** — Add `requireAdmin` to `send-bot-message`.
5. **C3** — Revoke `get_product_stock_items` from anon.
6. **C2** — Revoke `get_bot_quick_stats` from anon.
7. **C6** — Validate `x-sync-secret` in `sync-from-old`, `sync-from-old-db`.
8. **C7** — Add bearer check on `bootstrap-email-cron`.
9. **C5** — Add admin guard on `send-all-email-previews`.
10. **H9** — Remove env-var resolution in `resolve-payment-methods`.
11. **H7** — Replace `getClaims` with `getUser` in `customer-checkout`, `bkash-create-payment`, `upload-order-delivery-file`.
12. **H2, H3, H4** — Atomic conditional `UPDATE … WHERE status=? RETURNING id` pattern on confirm/reject withdrawal & refund-order.
13. **H1** — Add `UNIQUE(txn_hash)` on `bot_deposits`.
14. **H5** — Replace `customer-checkout` body with a single PL/pgSQL `place_customer_order` RPC.
15. **H6** — `submit-deposit-verification` must not store client-supplied amount in pending row.
16. **H10** — Replace service-role key as HMAC secret in `telegram-auth` with dedicated secret.
17. **H11** — Reuse `timingSafeEqual` everywhere secrets are compared.
18. **H12** — Add auth to `get-custom-emojis`.
19. **H13** — Add failed-attempt counter + rate limit on `bot-bind-telegram-confirm`.
20. **H14** — Restrict `google_account_cookies` table-grant to service_role only.

---

## 10. Security Score

Rated out of 10 (10 = production-ready for financial scale).

| Surface | Score | Justification |
|---------|------:|---------------|
| **API system (Edge Functions)** | 4/10 | Admin gates well-implemented, but 7 open/dangerous endpoints; no rate limit; non-timing-safe compares |
| **Telegram Bot** | 5/10 | Auth flows correct in concept; webhook runtime out-of-repo; key issuance shows plaintext in Telegram |
| **Mini App** | 6/10 | No price-tampering surface; auth_date check missing in webapp-auth; relies on edge functions for sensitive ops |
| **Website / Frontend** | 7/10 | No XSS surface, no service-role leak, correct anon-key usage; withdrawal flow is the weak point |
| **Admin Panel** | 6/10 | Real DB-backed role check; many writes depend solely on RLS quality; no audit log on several admin actions |
| **Database** | 3/10 | RLS is mostly good but **multiple SECURITY DEFINER RPCs are anon-callable** — this is the single biggest hole |
| **Payment system** | 3/10 | bKash callback unsigned + non-atomic; deposit has no UNIQUE constraint; admin paths non-atomic |
| **Wallet system** | 3/10 | Withdrawal 2-step on client; admin confirm/reject TOCTOU; no audit row on deposit verify |
| **Order / Delivery** | 5/10 | Stock reserve RPC is atomic; `customer-checkout` orchestration is not; refund TOCTOU |
| **Storage** | 6/10 | profile-uploads scoped correctly; site-assets misused for delivery files; no MIME enforcement |
| **Infrastructure** | 4/10 | No rate-limit, no anomaly alerting, no monitoring, no DR plan visible |
| **Secrets handling** | 7/10 | No secrets in `src/`; vault used for cron secret; service-role-as-HMAC is the misuse |

**Overall: 5 / 10** — Functional but not yet trustworthy for financial scale.

---

## 11. Final Verdict — Trust at Scale

| Scale | Verdict | Reason |
|-------|---------|--------|
| **1,000 users** | ⚠️ **Conditionally trustable** — only if top-9 critical fixes are applied this week. Without them, a single curious user with curl can drain unlimited balance via C1. |
| **10,000 users** | ❌ **Not trustable as-is.** With this many users the probability of one of them being a security researcher (or attacker) approaches 1. C1, C3, C8, C9 will be found and exploited within days of discovery. Need top-20 fixed + rate limiting + alerting. |
| **$100,000 yearly volume** | ❌ **Not trustable as-is.** A single exploit of C9 (withdrawal free-money) or C8 (deposit double-credit) can wipe out a month's profit. The platform has no anomaly detection, so the loss would compound before being noticed. Need top-20 + 24/7 monitoring + treasury reconciliation. |
| **$1,000,000 yearly volume** | ❌ **Absolutely not.** At this scale you are a paid target. Need: top-20 fixes, formal RLS audit by a third party, runtime WAF / rate limiter, real-time treasury reconciliation, on-call alerting for balance anomalies, signed bKash callbacks, separation of admin from production data, secret-rotation policy, periodic penetration tests. |

---

## 12. Recommended Hardening Roadmap (after this audit)

**Week 1 — Critical hardening (no traffic restriction needed)**
- Apply all 9 Critical fixes
- Add `UNIQUE(txn_hash)` constraint
- Revoke EXECUTE on all balance/stock RPCs

**Week 2 — Edge-function hardening**
- Apply High fixes (TOCTOU, getClaims→getUser, signature verification)
- Centralize `timingSafeEqual` and `requireAdmin`
- Add per-IP / per-user rate limit primitive shared across edge functions

**Week 3 — Observability**
- Anomaly alerting: order-velocity / refund-velocity / balance-change-velocity per customer
- Treasury reconciliation cron (sum of balances vs. sum of deposits − withdrawals − orders + refunds)
- Audit-row guarantee: every balance change has a row in `bot_balance_adjustments`

**Week 4 — Process & posture**
- Rotate all production secrets
- Set up Supabase CAPTCHA on auth
- Document RLS expectations for each table; add CI lint that rejects new public-schema functions without explicit GRANT/REVOKE
- Engage a 3rd-party penetration test before crossing $100k/yr volume

---

## Appendix A — Methodology & Evidence

- **5 parallel exploration agents** covered: edge functions (all 41), database (112 migration files, 3,572 SQL lines), payment/wallet/order flow (DB + edge code traced end-to-end), Telegram/mini-app (HMAC verification + bind flows), frontend (all `src/` direct Supabase calls, XSS, redirects).
- Findings reference exact `file:line` evidence; full evidence transcripts are in the agent run logs.
- Audit run on **2026-06-23**. No production data was modified. No code or migration was changed during this audit.

**End of report.**
