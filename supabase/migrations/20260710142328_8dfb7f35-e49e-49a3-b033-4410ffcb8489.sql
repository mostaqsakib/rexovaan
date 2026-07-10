UPDATE public.bot_deposits d
SET amount = ROUND(r.received_amount::numeric, 4)
FROM public.bep20_reserved_addresses r
WHERE r.deposit_id = d.id
  AND d.status = 'verified'
  AND r.received_amount IS NOT NULL
  AND r.received_amount > 0
  AND ABS(d.amount - r.received_amount) > 0.0001;

UPDATE public.bot_deposits d
SET amount = ROUND((r.paid_amount_ltc * r.ltc_usd_rate)::numeric, 4)
FROM public.ltc_reserved_addresses r
WHERE r.deposit_id = d.id
  AND d.status = 'verified'
  AND r.paid_amount_ltc IS NOT NULL
  AND r.paid_amount_ltc > 0
  AND ABS(d.amount - (r.paid_amount_ltc * r.ltc_usd_rate)) > 0.0001;