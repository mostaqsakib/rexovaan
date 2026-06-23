-- ============================================================
-- Atomic Checkout — Staging Test Script
-- Run these ONE BY ONE in Supabase SQL Editor
-- ============================================================

-- --------------------------------------------------------------
-- STEP 0: Turn flag ON for testing (so atomic path is active)
-- --------------------------------------------------------------
UPDATE bot_settings SET value='true' WHERE key='use_atomic_checkout';
SELECT value FROM bot_settings WHERE key='use_atomic_checkout';

-- --------------------------------------------------------------
-- STEP 1: Create disposable test customer ($1000 balance)
-- --------------------------------------------------------------
INSERT INTO bot_customers (chat_id, first_name, balance, pay_later_enabled)
VALUES (-9999000001, 'TEST-ATOMIC', 1000.00, false)
RETURNING id;
-- SAVE THIS UUID AS :tc

-- --------------------------------------------------------------
-- STEP 2: Create disposable test product ($1.00 each)
-- --------------------------------------------------------------
INSERT INTO bot_products (name, price, is_active, is_manual_delivery, category, description)
VALUES ('TEST-ATOMIC-PRODUCT', 1.00, true, false, 'test', 'verification')
RETURNING id;
-- SAVE THIS UUID AS :tp

-- --------------------------------------------------------------
-- STEP 3: Seed 50 stock items for the test product
-- --------------------------------------------------------------
-- Replace :tp below with the product ID from Step 2
INSERT INTO bot_product_stock_items (product_id, data, status, sort_index)
SELECT '00000000-0000-0000-0000-000000000000',
       jsonb_build_object('email', 'test' || gs || '@x.io', 'pass', 'p' || gs),
       'available',
       gs
FROM generate_series(1,50) gs;

-- --------------------------------------------------------------
-- STEP 4: Seed another test product with ONLY 5 stock (for race test T4)
-- --------------------------------------------------------------
INSERT INTO bot_products (name, price, is_active, is_manual_delivery, category, description)
VALUES ('TEST-ATOMIC-RACE', 1.00, true, false, 'test', 'race product')
RETURNING id;
-- SAVE THIS UUID AS :tp_race

-- Replace :tp_race below
INSERT INTO bot_product_stock_items (product_id, data, status, sort_index)
SELECT '00000000-0000-0000-0000-000000000001',
       jsonb_build_object('email', 'race' || gs || '@x.io', 'pass', 'r' || gs),
       'available',
       gs
FROM generate_series(1,5) gs;


-- ============================================================
-- TESTS: Replace :tc and :tp with the saved UUIDs before running
-- ============================================================

-- T1 — Single normal checkout (expect: 1 order, balance becomes 999)
SELECT * FROM checkout_balance_atomic(
  '00000000-0000-0000-0000-000000000000',  -- :tc
  '00000000-0000-0000-0000-000000000000',  -- :tp
  1, 1.0,
  'k-t1-' || gen_random_uuid()::text
);

-- T1 verify
SELECT balance FROM bot_customers WHERE id = '00000000-0000-0000-0000-000000000000';  -- expect 999.00

-- T2 — Double-click / same key (run BOTH lines quickly one after another)
SELECT * FROM checkout_balance_atomic(
  '00000000-0000-0000-0000-000000000000',  -- :tc
  '00000000-0000-0000-0000-000000000000',  -- :tp
  1, 1.0,
  'idem-t2-fixed-key'
);
-- run EXACTLY the same call again immediately:
SELECT * FROM checkout_balance_atomic(
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  1, 1.0,
  'idem-t2-fixed-key'
);

-- T2 verify
SELECT count(*) AS orders FROM bot_orders WHERE idempotency_key='idem-t2-fixed-key';          -- expect 1
SELECT count(*) AS ledger FROM wallet_ledger WHERE idempotency_key='idem-t2-fixed-key';       -- expect 1
SELECT count(*) AS audit FROM checkout_audit_logs WHERE idempotency_key='idem-t2-fixed-key'; -- expect 2 (completed + replay)
SELECT balance FROM bot_customers WHERE id='00000000-0000-0000-0000-000000000000';            -- expect 998.00

-- T3 — Multi-tab / different keys (run both, order doesn't matter)
SELECT * FROM checkout_balance_atomic(:tc, :tp, 1, 1.0, 'k-t3-a');
SELECT * FROM checkout_balance_atomic(:tc, :tp, 1, 1.0, 'k-t3-b');
-- expect 2 orders, 2 ledger rows, balance 996.00

-- T4 — Race for last unit (open multiple SQL Editor tabs, run together when only 5 stock left)
-- First reset the race product stock if needed:
-- UPDATE bot_product_stock_items SET status='available', sold_order_id=NULL WHERE product_id = :tp_race;
-- Then run this in 10+ tabs simultaneously:
SELECT * FROM checkout_balance_atomic(:tc, :tp_race, 1, 1.0, 'k-t4-' || gen_random_uuid()::text);
-- After running, verify:
SELECT count(*) FROM bot_orders WHERE product_id = :tp_race;                       -- expect 5
SELECT count(*) FROM wallet_ledger WHERE reference_order_id IN (
  SELECT id FROM bot_orders WHERE product_id = :tp_race
);                                                                                   -- expect 5

-- T8 — Browser retry / refresh (run same call twice)
SELECT * FROM checkout_balance_atomic(:tc, :tp, 1, 1.0, 'idem-t8-fixed');
SELECT * FROM checkout_balance_atomic(:tc, :tp, 1, 1.0, 'idem-t8-fixed');

-- T8 verify
SELECT count(*) AS audit_rows,
       sum(CASE WHEN was_idempotent_hit THEN 1 ELSE 0 END) AS replays
FROM checkout_audit_logs WHERE idempotency_key='idem-t8-fixed';  -- expect (2, 1)
SELECT count(*) FROM wallet_ledger WHERE idempotency_key='idem-t8-fixed';  -- expect 1
SELECT count(*) FROM bot_orders WHERE idempotency_key='idem-t8-fixed';     -- expect 1

-- T9 — Ledger integrity at scale (run 100 times with different keys)
-- Since SQL Editor is single-session, run this block once to fire 100 keys:
DO $$
DECLARE
  i INT;
  rec RECORD;
  tc UUID := '00000000-0000-0000-0000-000000000000';  -- :tc
  tp UUID := '00000000-0000-0000-0000-000000000000';  -- :tp
BEGIN
  FOR i IN 1..100 LOOP
    SELECT * INTO rec FROM checkout_balance_atomic(
      tc, tp, 1, 1.0,
      'k-t9-' || i::text || '-' || gen_random_uuid()::text
    );
  END LOOP;
END $$;

-- T9 verify
SELECT
  c.balance AS current_balance,
  (SELECT SUM(amount) FROM wallet_ledger WHERE customer_id = c.id) AS ledger_sum,
  (SELECT count(*) FROM wallet_ledger WHERE customer_id = c.id) AS ledger_rows,
  (SELECT count(*) FROM bot_orders WHERE customer_id = c.id) AS order_rows,
  (SELECT count(DISTINCT idempotency_key) FROM wallet_ledger WHERE customer_id = c.id) AS unique_keys
FROM bot_customers c WHERE c.chat_id = -9999000001;
-- Pass if:
--   current_balance + |ledger_sum| = starting_balance (1000)
--   ledger_rows = order_rows = unique_keys


-- ============================================================
-- CLEANUP: Remove all test data when done
-- ============================================================
-- DELETE FROM wallet_ledger WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
-- DELETE FROM checkout_audit_logs WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
-- DELETE FROM bot_orders WHERE customer_id IN (SELECT id FROM bot_customers WHERE chat_id = -9999000001);
-- DELETE FROM bot_product_stock_items WHERE product_id IN (SELECT id FROM bot_products WHERE name LIKE 'TEST-ATOMIC%');
-- DELETE FROM bot_products WHERE name LIKE 'TEST-ATOMIC%';
-- DELETE FROM bot_customers WHERE chat_id = -9999000001;

-- ============================================================
-- FINAL FLIP: Enable atomic checkout globally after all tests pass
-- ============================================================
-- UPDATE bot_settings SET value='true' WHERE key='use_atomic_checkout';
-- SELECT value FROM bot_settings WHERE key='use_atomic_checkout';
