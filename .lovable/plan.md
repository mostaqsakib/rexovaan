# LTC (Litecoin) Payment Gateway

Trust Wallet er xpub theke proti order-e unique LTC address auto-generate hobe, block explorer diye auto-verify hobe. Same pattern jeta BEP20/Polygon e ache.

## Phase 1 — Database

**New tables:**
- `ltc_settings` — singleton: `xpub`, `next_index`, `script_type` (bip84/bip49/bip44), `watcher_last_height`, `min_confirmations` (default 2)
- `ltc_reserved_addresses` — `order_id`, `deposit_id`, `address`, `derivation_index`, `expected_amount_ltc`, `expected_amount_usd`, `status` (pending/paid/expired), `expires_at`, `paid_tx_hash`, `paid_amount_ltc`, `paid_at`
- `ltc_payment_registry` — `tx_hash`, `vout`, `address`, `amount_ltc`, `block_height`, `confirmations`, `credited_at` (idempotency)

**Extend `bot_deposits`:** add `ltc_address`, `ltc_tx_hash` columns.

## Phase 2 — Address Derivation

Shared module `supabase/functions/_ltc/derive.ts`:
- `zpub`/`ypub`/`xpub` → child pubkey (path `m/0/i`)
- Encode as bech32 (`ltc1...` for zpub/BIP84), p2sh-segwit (`M...` for ypub/BIP49), or legacy (`L...` for xpub/BIP44)
- Uses `@scure/bip32` + `@scure/base` (bech32) — Deno esm.sh compatible

## Phase 3 — Reserve Endpoint

`ltc-reserve-address` edge function:
- Input: `order_id`, `expected_usd`
- Fetch LTC/USD price (CoinGecko), compute `expected_ltc`
- Atomically increment `next_index`, derive address, insert row with 30-min expiry
- Return: address, amount_ltc, qr_data (`litecoin:<addr>?amount=<ltc>`), expires_at

## Phase 4 — Watcher (auto-verify)

`ltc-watcher` edge function, cron every 60s:
- Use **Blockstream-style Litecoin explorer API** (`https://litecoinspace.org/api`) — free, no key needed, similar to mempool.space
- For each `pending` address: GET `/address/{addr}/txs` → filter confirmed txs with 2+ confirmations
- Skip if `(tx_hash, vout)` already in `ltc_payment_registry`
- Match amount (tolerance ±1%), credit `bot_deposits`, notify customer, mark address `paid`
- Overpay → credit actual; underpay → keep open till expiry

## Phase 5 — Bot + Admin

- Add "Litecoin (LTC)" to `bot_payment_methods` (sort_order after TON)
- Bot flow: amount → reserve address → QR + address + countdown + polling
- Admin panel: `OnChainActivityTab` e LTC section — reserved addresses list, live tx status, manual re-scan button
- Web deposit page (`Deposit.tsx`) — same LTC option

## Phase 6 — Sweeping

**v1: skip auto-sweep.** LTC funds derived addresses e stack hoye thakbe; tumi occasionally Trust Wallet e seed import kore manually sweep korba. Safer — xprv server e rakhte hobe na.

(Future: if you want auto-sweep, add `LTC_XPRV` secret and sign-transaction module.)

## Technical Details

- **Script type detection:** xpub prefix theke auto-detect (`zpub`→BIP84, `ypub`→BIP49, `xpub`→BIP44)
- **Explorer:** litecoinspace.org (primary), Blockcypher (fallback) — no API key needed for basic reads
- **Confirmations:** 2 blocks (~5 min) for auto-credit
- **Price feed:** CoinGecko `/simple/price?ids=litecoin&vs_currencies=usd`, cached 60s

## Deliverables

- 3 tables + RLS + grants
- 2 edge functions (`ltc-reserve-address`, `ltc-watcher`)
- `_ltc/derive.ts` shared module
- pg_cron entry (60s watcher)
- Bot payment method entry with LTC emoji
- Admin panel LTC section in OnChainActivityTab
- Standalone bot integration for LTC option
