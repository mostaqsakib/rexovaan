UPDATE public.bot_deposits
SET status='verified',
    verified_at=COALESCE(verified_at, now()),
    bep20_tx_hash='0x344c45ad358499dc279f8a81e8db503352c578bbfb14c66cebaa23061bc25a87',
    txn_hash='0x344c45ad358499dc279f8a81e8db503352c578bbfb14c66cebaa23061bc25a87',
    bep20_token=COALESCE(bep20_token,'USDT'),
    amount=4.99
WHERE id='4c70ffc4-1e89-4eb5-a380-619084c97790';