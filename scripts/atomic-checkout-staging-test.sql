-- ============================================================
-- Atomic Checkout — Staging Test Script (Supabase SQL Editor compatible)
-- Run each STEP block separately. NO manual UUID replacement needed.
-- All lookups use chat_id = -9999000001 and product name LIKE 'TEST-ATOMIC%'
-- ============================================================

-- ============================================================
-- STEP 0 — Enable atomic flag (staging)
-- ============================================================
UPDATE bot_settings SET value='true' WHERE key='use_atomic_checkout';
SELECT value FROM bot_settings WHERE key='use_atomic_checkout';


-- ============================================================
-- STEP 1 — Seed test customer + 2 test products + stock
-- (Safe to re-run: uses ON CONFLICT / cleanup-first pattern)
-- ============================================================
DO $$
DECLARE
  v_tc UUID;
  v_tp UUID;
  v_tp_race UUID;
BEGIN
  -- Wipe any previous test data first (clean slate)
  DELETE FROM wallet_ledger        WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  DELETE FROM checkout_audit_logs  WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  DELETE FROM bot_orders           WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  DELETE FROM bot_product_stock_items WHERE product_id IN (SELECT id FROM bot_products WHERE name LIKE 'TEST-ATOMIC%');
  DELETE FROM bot_products         WHERE name LIKE 'TEST-ATOMIC%';
  DELETE FROM bot_customers        WHERE chat_id = -9999000001;

  -- Customer
  INSERT INTO bot_customers (chat_id, balance, pay_later_enabled)
  VALUES (-9999000001, 1000.00, false)
  RETURNING id INTO v_tc;

  -- Product 1 (main)
  INSERT INTO bot_products (name, sheet_tab, price, is_active, is_manual_delivery, stock_source, description)
  VALUES ('TEST-ATOMIC-PRODUCT', 'test-atomic', 1.00, true, false, 'manual', 'verification')
  RETURNING id INTO v_tp;

  INSERT INTO bot_product_stock_items (product_id, data, status)
  SELECT v_tp,
         jsonb_build_object('email', 'test'||gs||'@x.io', 'pass', 'p'||gs),
         'available'
  FROM generate_series(1,50) gs;

  -- Product 2 (race — only 5 stock)
  INSERT INTO bot_products (name, sheet_tab, price, is_active, is_manual_delivery, stock_source, description)
  VALUES ('TEST-ATOMIC-RACE', 'test-atomic-race', 1.00, true, false, 'manual', 'race product')
  RETURNING id INTO v_tp_race;

  INSERT INTO bot_product_stock_items (product_id, data, status, sort_index)
  SELECT v_tp_race,
         jsonb_build_object('email', 'race'||gs||'@x.io', 'pass', 'r'||gs),
         'available', gs
  FROM generate_series(1,5) gs;

  RAISE NOTICE 'Seeded customer=%, product=%, race=%', v_tc, v_tp, v_tp_race;
END $$;

-- Confirm seed
SELECT id, chat_id, balance FROM bot_customers WHERE chat_id = -9999000001;
SELECT id, name FROM bot_products WHERE name LIKE 'TEST-ATOMIC%';


-- ============================================================
-- T1 — Single normal checkout (expect 1 order, balance 999)
-- ============================================================
DO $$
DECLARE
  v_tc UUID := (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  v_tp UUID := (SELECT id FROM bot_products  WHERE name = 'TEST-ATOMIC-PRODUCT');
  rec RECORD;
BEGIN
  SELECT * INTO rec FROM checkout_balance_atomic(v_tc, v_tp, 1, 1.0, 'k-t1-'||gen_random_uuid()::text);
  RAISE NOTICE 'T1 result: %', rec;
END $$;

SELECT balance FROM bot_customers WHERE chat_id = -9999000001;  -- expect 999.00


-- ============================================================
-- T2 — Idempotency: same key twice (expect 1 order, 1 ledger, 2 audit, balance 998)
-- ============================================================
DO $$
DECLARE
  v_tc UUID := (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  v_tp UUID := (SELECT id FROM bot_products  WHERE name = 'TEST-ATOMIC-PRODUCT');
BEGIN
  PERFORM checkout_balance_atomic(v_tc, v_tp, 1, 1.0, 'idem-t2-fixed-key');
  PERFORM checkout_balance_atomic(v_tc, v_tp, 1, 1.0, 'idem-t2-fixed-key');
END $$;

SELECT
  (SELECT count(*) FROM bot_orders          WHERE idempotency_key='idem-t2-fixed-key') AS orders,       -- 1
  (SELECT count(*) FROM wallet_ledger       WHERE idempotency_key='idem-t2-fixed-key') AS ledger,       -- 1
  (SELECT count(*) FROM checkout_audit_logs WHERE idempotency_key='idem-t2-fixed-key') AS audit,        -- 2
  (SELECT balance  FROM bot_customers       WHERE chat_id=-9999000001)                  AS balance;     -- 998.00


-- ============================================================
-- T3 — Two distinct keys back-to-back (expect 2 orders, balance 996)
-- ============================================================
DO $$
DECLARE
  v_tc UUID := (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  v_tp UUID := (SELECT id FROM bot_products  WHERE name = 'TEST-ATOMIC-PRODUCT');
BEGIN
  PERFORM checkout_balance_atomic(v_tc, v_tp, 1, 1.0, 'k-t3-a');
  PERFORM checkout_balance_atomic(v_tc, v_tp, 1, 1.0, 'k-t3-b');
END $$;

SELECT balance FROM bot_customers WHERE chat_id = -9999000001;  -- expect 996.00


-- ============================================================
-- T4 — Stock exhaustion (race product has only 5 stock — try 10 buys)
-- Expect exactly 5 success, 5 fail with insufficient_stock; balance drops by 5
-- ============================================================
DO $$
DECLARE
  v_tc UUID := (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  v_tp_race UUID := (SELECT id FROM bot_products WHERE name = 'TEST-ATOMIC-RACE');
  i INT;
  v_success INT := 0;
  v_fail INT := 0;
  rec RECORD;
BEGIN
  FOR i IN 1..10 LOOP
    BEGIN
      SELECT * INTO rec FROM checkout_balance_atomic(
        v_tc, v_tp_race, 1, 1.0, 'k-t4-'||i::text||'-'||gen_random_uuid()::text
      );
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
    END;
  END LOOP;
  RAISE NOTICE 'T4 success=% fail=%', v_success, v_fail;  -- expect 5 / 5
END $$;

SELECT count(*) AS race_orders FROM bot_orders
WHERE product_id = (SELECT id FROM bot_products WHERE name = 'TEST-ATOMIC-RACE');  -- expect 5


-- ============================================================
-- T9 — Ledger integrity at scale (100 checkouts)
-- ============================================================
DO $$
DECLARE
  v_tc UUID := (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
  v_tp UUID := (SELECT id FROM bot_products  WHERE name = 'TEST-ATOMIC-PRODUCT');
  i INT;
BEGIN
  FOR i IN 1..100 LOOP
    PERFORM checkout_balance_atomic(
      v_tc, v_tp, 1, 1.0,
      'k-t9-'||i::text||'-'||gen_random_uuid()::text
    );
  END LOOP;
END $$;

-- T9 verify — pass if: 1000 - |ledger_sum| = current_balance AND ledger_rows = order_rows = unique_keys
SELECT
  c.balance AS current_balance,
  (SELECT SUM(amount) FROM wallet_ledger WHERE customer_id = c.id) AS ledger_sum,
  (SELECT count(*)    FROM wallet_ledger WHERE customer_id = c.id) AS ledger_rows,
  (SELECT count(*)    FROM bot_orders    WHERE customer_id = c.id) AS order_rows,
  (SELECT count(DISTINCT idempotency_key) FROM wallet_ledger WHERE customer_id = c.id) AS unique_keys
FROM bot_customers c WHERE c.chat_id = -9999000001;


-- ============================================================
-- CLEANUP — Run this after all tests pass
-- ============================================================
-- DELETE FROM wallet_ledger        WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
-- DELETE FROM checkout_audit_logs  WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
-- DELETE FROM bot_orders           WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
-- DELETE FROM bot_product_stock_items WHERE product_id IN (SELECT id FROM bot_products WHERE name LIKE 'TEST-ATOMIC%');
-- DELETE FROM bot_products         WHERE name LIKE 'TEST-ATOMIC%';
-- DELETE FROM bot_customers        WHERE chat_id = -9999000001;

-- ============================================================
-- FINAL FLIP — Enable atomic checkout globally (already 'true' from STEP 0;
-- if you turned it off during testing, re-enable here)
-- ============================================================
-- UPDATE bot_settings SET value='true' WHERE key='use_atomic_checkout';
-- SELECT value FROM bot_settings WHERE key='use_atomic_checkout';
