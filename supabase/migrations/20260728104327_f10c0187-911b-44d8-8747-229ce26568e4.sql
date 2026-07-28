
DO $$
DECLARE
  v_dep_id uuid := 'd95ba654-3f05-4d97-a51b-2502ac8a6c36';
  v_cust_id uuid := 'f1cd9841-9b15-4b34-875b-112f59a8a964';
  v_amount numeric := 2.65;
  v_tx text := '6805a184c075271970a777fc4cfa1609e6bd28a39b7562131961c22fe6173c2f';
  v_res_id uuid := '2ab89a54-6d77-4298-bce0-8d79ed2c991f';
  v_used numeric;
  v_enabled boolean;
  v_deduct numeric := 0;
  v_remaining numeric := v_amount;
BEGIN
  SELECT COALESCE(pay_later_used,0), COALESCE(pay_later_enabled,false)
    INTO v_used, v_enabled FROM public.bot_customers WHERE id = v_cust_id;

  IF v_enabled AND v_used > 0 THEN
    v_deduct := LEAST(v_used, v_remaining);
    PERFORM public.refund_pay_later_credit(v_cust_id, v_deduct);
    v_remaining := v_remaining - v_deduct;
  END IF;

  IF v_remaining > 0 THEN
    PERFORM public.refund_customer_balance(v_cust_id, v_remaining);
  END IF;

  UPDATE public.bot_deposits
     SET status = 'verified',
         verified_at = now(),
         amount = v_amount,
         txn_hash = v_tx
   WHERE id = v_dep_id;

  UPDATE public.ton_reserved_deposits
     SET status = 'late_paid',
         received_amount = v_amount,
         tx_hash = v_tx,
         paid_at = now()
   WHERE id = v_res_id;
END $$;
