# Atomic Checkout & Stock Reservation — Deep Audit

**Date:** 2026-06-23
**Scope:** Web checkout (balance payment) + bKash deposit init + admin reserve stock
**Status:** Audit only — no code changes, no deployment

---

## 1. Executive Summary

The current web checkout (`customer-checkout`) is a **multi-step edge function** that performs four separate database operations against four different RPCs/tables without a wrapping transaction:

1. `INSERT bot_orders` (status=`completed`)
2. `rpc reserve_internal_stock_items`
3. `rpc deduct_customer_balance`
4. `UPDATE bot_orders SET details, delivered_at`

If the edge function dies (timeout, network error, OOM, isolate eviction) between any two of these steps, the system is left in an inconsistent state. The function relies on **compensating deletes / RPC rollbacks** that are themselves not guaranteed to run.

There is **no idempotency key**, **no row-level lock on the customer row before balance check**, and **no protection against double-submit** beyond client-side button disable. The `bot_orders` row is inserted with `status='completed'` **before** stock is reserved or balance is deducted — meaning a crash between step 1 and step 2 produces a "completed" order with no stock and no debit.

**Verdict:** the flow is functional under happy path but unsafe under concurrency, retry, or partial failure.

---

## 2. Files & Functions In Scope

| File | Role |
|------|------|
| `supabase/functions/customer-checkout/index.ts` | Main web checkout (balance payment only) |
| `supabase/functions/bkash-create-payment/index.ts` | bKash deposit initiation — NOT a checkout, just funds wallet |
| `supabase/functions/admin-reserve-stock/index.ts` | Admin manual reserve (test path) |
| `src/pages/customer/Checkout.tsx` (L94-103) | Client caller — single `place()` handler, button disabled via `placing` state only |
| `src/store/useProductStore.ts` (L227) | Calls `admin-reserve-stock` from admin UI |
| **DB RPCs** | |
| `public.reserve_internal_stock_items(_product_id, _quantity, _order_id)` | Picks N available rows with `FOR UPDATE SKIP LOCKED`, flips to `sold` |
| `public.deduct_customer_balance(_customer_id, _amount)` | `SELECT … FOR UPDATE`, subtracts |
| `public.restore_internal_stock_items(_order_id)` | Compensating restore |
| `public.refund_customer_balance(_customer_id, _amount)` | Compensating refund |

**Note:** `customer-cart-checkout` and `shop-checkout` referenced in the brief **do not exist** in the codebase. Only `customer-checkout` handles web orders. Bot orders go through Telegram handlers (separate path, out of this audit).

---

## 3. Root Cause Analysis

### 3.1 No transactional boundary
Each step in `customer-checkout/index.ts` (L140-174) is a separate PostgREST call over HTTP. Postgres opens, commits, and closes a transaction **per RPC/insert**. There is no `BEGIN…COMMIT` covering the multi-step flow. Compensating deletes (L161, L170) are best-effort and run from the same edge isolate that just failed.

### 3.2 Order created in wrong state
`bot_orders` is inserted with `status='completed'` (L147) **before** stock is confirmed and balance is debited. The intent is "optimistic write, fix up later," but downstream readers (admin dashboard, customer order list, email triggers, sales-feed notifier) will see a completed order that may not have stock or a debit attached.

### 3.3 No idempotency key
The client sends `{ productId, quantity, paymentMethod }` — nothing that uniquely identifies the *attempt*. Network retries (React Query, browser back/forward, double-click, multi-tab) re-invoke the function and create **multiple orders** debiting the wallet multiple times. The button-disable in `Checkout.tsx` (L95 `setPlacing(true)`) is purely client-side and resets on remount.

### 3.4 Balance check is racy (TOCTOU)
L135 reads `customer.balance` from a snapshot fetched at L81 (no `FOR UPDATE`). Between that read and the `deduct_customer_balance` RPC at L167, another concurrent checkout (or withdrawal) can drain the balance. The RPC itself locks correctly (`SELECT … FOR UPDATE` inside the function), so the deduction is safe — but the **earlier "Insufficient balance" 400** can be wrong in either direction, and the early-exit logic can let two orders both pass the JS-side check and the second one fail at RPC time leaving an orphan order + reserved stock.

### 3.5 Price re-resolution outside transaction
Lines 91-128 resolve `unitPrice` in JS via 3 separate selects (special, tier, flash). These are not locked and not re-checked at deduction time. A flash sale ending mid-checkout, or admin price edit, produces a debited amount that disagrees with the live price.

### 3.6 Compensation gaps
- L161: `DELETE bot_orders` after `reserve_internal_stock_items` fails — but the stock RPC already raises and aborts its own work, so this delete is the only cleanup. If the network drops *here*, the order row stays as `completed` with empty `details`.
- L169-170: stock + order cleanup after `deduct_customer_balance` fails. If the second compensation call fails (network), stock stays `sold` against an order that gets deleted (or vice versa).
- No compensation at all for the final `UPDATE bot_orders SET details, delivered_at` (L174). If this update fails, the order is `completed`, balance deducted, stock sold, but `details=[]` so the customer sees an empty delivery.

### 3.7 bKash deposit path
`bkash-create-payment` is a deposit funnel, not a checkout. It inserts a `bot_deposits` row with `amount=0` (L114-119) **after** bKash returns a payment URL. If bKash returns success but the insert fails, the user pays bKash and we have no record. There is no idempotency on `merchantInvoiceNumber` either — the unique-ish part is `INV{Date.now()}` (L75) which collides under 1ms-apart concurrent requests.

---

## 4. Attack & Failure Scenarios

| # | Scenario | Outcome Today |
|---|----------|---------------|
| A1 | User double-clicks "Place order" | 2 orders, 2 debits, 2× stock consumed |
| A2 | User opens 2 tabs, checks out same product | Same as A1; client guard is per-tab |
| A3 | Network drops between order insert and stock reserve | Order row `status=completed`, `details=[]`, no stock, no debit |
| A4 | Network drops between stock reserve and balance deduct | Stock locked as `sold`, no debit, orphan order. Customer gets nothing, stock leaks |
| A5 | Network drops during final `UPDATE details` | Balance debited, stock sold, but `details=[]` — customer sees empty delivery |
| A6 | Two users race for the last unit | Stock RPC handles correctly (SKIP LOCKED), loser gets clean 400 — **OK** |
| A7 | Two checkouts drain a low balance | JS-side balance check (L135) can pass for both; second `deduct_customer_balance` returns `success=false`; compensation runs — **mostly OK but creates orphan order under network failure** |
| A8 | Flash sale ends mid-checkout | Price drift between resolution and deduction; debit can be higher than current displayed price |
| A9 | Replay attack (curl repost of edge fn call) | No nonce → each replay creates a fresh order until balance/stock runs out |
| A10 | bKash `INV{Date.now()}` collision | <1ms apart requests get same invoice id; bKash may reject or accept duplicate |

---

## 5. Proposed Fix — Single Atomic RPC

### 5.1 New function: `public.checkout_balance_atomic`

```sql
CREATE OR REPLACE FUNCTION public.checkout_balance_atomic(
  _customer_id      uuid,
  _product_id       uuid,
  _quantity         integer,
  _expected_unit    numeric,         -- client-confirmed price ceiling
  _idempotency_key  text             -- unique per attempt
)
RETURNS TABLE(order_id uuid, total_price numeric, unit_price numeric, details jsonb, new_balance numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer    public.bot_customers%ROWTYPE;
  v_product     public.bot_products%ROWTYPE;
  v_unit        numeric;
  v_total       numeric;
  v_order_id    uuid;
  v_details     jsonb;
  v_picked      integer;
  v_existing    uuid;
BEGIN
  -- 1. Idempotency short-circuit
  SELECT id INTO v_existing FROM public.bot_orders
   WHERE idempotency_key = _idempotency_key AND customer_id = _customer_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY
      SELECT o.id, o.total_price, (o.total_price/NULLIF(o.quantity,0)), o.details,
             (SELECT balance FROM public.bot_customers WHERE id = _customer_id)
        FROM public.bot_orders o WHERE o.id = v_existing;
    RETURN;
  END IF;

  -- 2. Lock customer row (blocks concurrent debits)
  SELECT * INTO v_customer FROM public.bot_customers
   WHERE id = _customer_id FOR UPDATE;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF v_customer.is_banned THEN RAISE EXCEPTION 'Account banned'; END IF;

  -- 3. Lock product row
  SELECT * INTO v_product FROM public.bot_products
   WHERE id = _product_id AND is_active = true FOR UPDATE;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'Product not available'; END IF;
  IF v_product.is_manual_delivery THEN RAISE EXCEPTION 'Manual delivery only'; END IF;

  -- 4. Re-resolve price authoritatively (same MIN(base, tier, special, flash))
  SELECT MIN(v) INTO v_unit FROM unnest(ARRAY[
    v_product.price,
    (SELECT price FROM public.bot_product_pricing WHERE product_id = _product_id
        AND min_quantity <= _quantity ORDER BY min_quantity DESC LIMIT 1),
    (SELECT price FROM public.bot_customer_pricing WHERE customer_id = _customer_id
        AND product_id = _product_id AND is_active AND min_quantity <= _quantity
        ORDER BY min_quantity DESC LIMIT 1),
    (SELECT sale_price FROM public.bot_flash_sales WHERE product_id = _product_id
        AND is_active AND starts_at <= now() AND ends_at >= now()
        ORDER BY sale_price ASC LIMIT 1)
  ]) AS c(v) WHERE v IS NOT NULL AND v > 0;

  IF v_unit IS NULL THEN RAISE EXCEPTION 'Product not purchasable'; END IF;

  -- 5. Anti-bait: reject if server price drifted above what client confirmed
  IF v_unit > _expected_unit + 0.001 THEN
    RAISE EXCEPTION 'Price changed, please refresh' USING ERRCODE = 'P0002';
  END IF;

  v_total := ROUND(v_unit * _quantity, 2);

  -- 6. Balance check (row already locked at step 2)
  IF v_customer.balance < v_total THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  -- 7. Create order shell with idempotency key
  INSERT INTO public.bot_orders (customer_id, product_id, product_name, quantity,
                                 total_price, payment_method, status, details, row_numbers,
                                 source, idempotency_key)
  VALUES (_customer_id, _product_id, v_product.name, _quantity, v_total, 'balance',
          'completed', '[]'::jsonb, ARRAY[]::integer[], 'web', _idempotency_key)
  RETURNING id INTO v_order_id;

  -- 8. Reserve stock (SKIP LOCKED; flip to sold)
  WITH picked AS (
    SELECT s.id, s.data FROM public.bot_product_stock_items s
     WHERE s.product_id = _product_id AND s.status = 'available'
     ORDER BY s.sort_index, s.id LIMIT _quantity FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.bot_product_stock_items s
       SET status='sold', sold_order_id=v_order_id, sold_at=now(), updated_at=now()
      FROM picked WHERE s.id = picked.id
    RETURNING s.data
  )
  SELECT COALESCE(jsonb_agg(data), '[]'::jsonb), count(*)::int INTO v_details, v_picked FROM upd;

  IF v_picked < _quantity THEN RAISE EXCEPTION 'Not enough stock'; END IF;

  -- 9. Debit balance
  UPDATE public.bot_customers
     SET balance = balance - v_total, updated_at = now()
   WHERE id = _customer_id;

  -- 10. Finalize order
  UPDATE public.bot_orders
     SET details = v_details, delivered_at = now()
   WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total, v_unit, v_details, (v_customer.balance - v_total);
END;
$$;
```

Postgres wraps the entire function body in a single transaction. **All 10 steps commit together or none do.** Any `RAISE EXCEPTION` rolls back every prior step automatically — no compensation logic needed.

### 5.2 Schema change

```sql
ALTER TABLE public.bot_orders ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX bot_orders_customer_idem_uniq
  ON public.bot_orders(customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### 5.3 Edge function rewrite

`customer-checkout/index.ts` becomes:

```ts
const { productId, quantity, paymentMethod, idempotencyKey, expectedUnit } = await req.json();
// auth + input validation as before
const { data, error } = await admin.rpc('checkout_balance_atomic', {
  _customer_id: customer.id,
  _product_id: productId,
  _quantity: quantity,
  _expected_unit: Number(expectedUnit),
  _idempotency_key: idempotencyKey,
});
if (error) return json({ error: error.message }, 400);
const row = data[0];
// notify sales feed in EdgeRuntime.waitUntil
return json({ orderId: row.order_id, totalPrice: row.total_price, unitPrice: row.unit_price, details: row.details });
```

### 5.4 Client change (`Checkout.tsx`)

```ts
const idempotencyKey = useMemo(() => crypto.randomUUID(), [productId]);
// pass idempotencyKey + expectedUnit (the unitPrice currently shown) into invoke
```

Key is generated **once per product-page mount**, so retries from the same page reuse it; opening a new tab generates a new key (intentional — different attempt).

### 5.5 bKash hardening (out of strict atomic-checkout scope, but related)

- Replace `INV${Date.now()}` with `INV-${crypto.randomUUID()}`
- Insert the `bot_deposits` row **before** calling bKash, status `bkash_initializing`; flip to `bkash_pending` after URL returned; rollback to `failed` if bKash call throws. Use the deposit row's UUID as `merchantInvoiceNumber`.
- Add unique index on `bot_deposits(txn_hash)` (already implied by `bkash_${paymentID}` but not enforced).

---

## 6. Verification Plan

Before/after each scenario, assert via SQL: orders count, sum(total_price), customer.balance delta, `bot_product_stock_items` count by status.

| Test | Method | Pass criteria |
|------|--------|---------------|
| T1 Double-click | Playwright: click button twice within 50ms | Exactly 1 order, 1 debit, N stock sold |
| T2 Multi-tab | Open 2 tabs, both click within 200ms | 2 orders (different keys) succeed if stock+balance allow; otherwise one clean 400 |
| T3 Same-tab refresh + replay | Capture invoke body, curl it 5× | Exactly 1 order — others return original order |
| T4 Race for last unit | k6 with 20 concurrent users on `stock=5` | Exactly 5 succeed, 15 get 400 "Not enough stock" |
| T5 Mid-flow crash | Inject `pg_sleep + pg_terminate_backend` between steps via test harness | Either nothing committed or everything committed — never partial |
| T6 Price drift | Admin lowers flash price after client loaded page | Order succeeds at lower price (server resolves authoritatively) |
| T7 Price drift up | Admin raises base price | Server raises `Price changed`, client refreshes |

---

## 7. Rollback Plan

1. Migration is additive (new column + new function + new unique index). No drops.
2. Edge function deploys behind a flag `USE_ATOMIC_CHECKOUT=true`. Falsy → old code path stays.
3. To revert: set flag false; redeploy old `customer-checkout/index.ts`. Database column and RPC remain (no-op).
4. If the unique index causes inserts to fail (e.g. forgotten key), drop with `DROP INDEX CONCURRENTLY bot_orders_customer_idem_uniq;` — back to old behavior in seconds.

---

## 8. Risk Assessment

| Risk | Likelihood | Severity | Mitigation |
|------|-----------|----------|------------|
| RPC raises new exception types client doesn't handle | M | L | Map all `RAISE EXCEPTION` strings to friendly toasts in `place()` |
| Idempotency cache hits return stale `new_balance` | L | L | Re-fetch via `refreshCustomer()` post-call (already done) |
| Long-running transaction holds locks | L | M | Function is ~10 statements, all indexed; expected <50ms |
| Web UI doesn't generate UUIDs (older browsers) | L | L | `crypto.randomUUID` supported in all targets; fallback to `nanoid` |

---

## 9. Out of Scope (Acknowledged but Not Fixed Here)

- Telegram bot order paths (separate handler, separate RPC `place_reseller_api_order` is already atomic)
- Cart / multi-product checkout — no such feature exists yet; this design extends to it by accepting `_items jsonb` later
- bKash full reconciliation loop (covered in N7 fix already shipped)

---

## 10. Next Steps (awaiting approval)

1. **Approve this plan** — no code/DB changes yet
2. Create migration adding `idempotency_key` column + `checkout_balance_atomic` RPC
3. Update `customer-checkout/index.ts` to call the new RPC
4. Update `src/pages/customer/Checkout.tsx` to send `idempotencyKey` + `expectedUnit`
5. Run T1-T7 verification scenarios
6. Deploy behind flag; monitor 24h; flip flag on

---

**End of audit. No code modified. No deployment performed.**
