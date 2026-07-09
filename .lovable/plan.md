# BEP20 USDT/USDC Gateway — Rexovaan Shoppie Integration

Full self-hosted BSC payment gateway using xpub-derived per-order addresses, on-chain auto-verification, and auto-sweep to your Trust Wallet.

**Sweep destination:** `0xefbDe79E25D1DF2F54C1851F670EF3ef33E322e3`
**Tokens accepted:** USDT (BEP20) + USDC (BEP20) — same address
**Confirmations:** 3 blocks (~9 sec)

---

## Phase 1 — Foundation (DB + Secrets)

**New tables:**
- `bep20_reserved_addresses` — order_id, address, derivation_index, xpub_fingerprint, status (pending/paid/expired/swept), expected_amount, token, created_at, expires_at
- `bep20_payment_registry` — tx_hash, log_index, address, token, amount, block_number, confirmations, credited_at (idempotency guard)
- `bep20_settings` — singleton row: xpub, next_index, sweep_destination, gas_tank_address, min_gas_balance, watcher_last_block

**Extend `bot_deposits`:** add `bep20_address`, `bep20_tx_hash`, `bep20_token` columns.

**Secrets needed (via `add_secret`):**
- `BSC_XPUB` — your dedicated BSC xpub (you'll paste securely)
- `BSC_RPC_URL` — public RPC (default: `https://bsc-dataseed.binance.org`) or paid (QuickNode/Ankr) if traffic grows
- `BSC_SWEEP_PRIVATE_KEY` — private key of dedicated hot wallet (index 0) that holds BNB for gas + does sweep signing. **This is NOT your main Trust Wallet key.**

## Phase 2 — Address Derivation Library

Edge function shared module `_bep20/derive.ts`:
- BIP32 xpub → child address derivation (path `m/0/i` from account xpub)
- Uses `@noble/hashes` + `@scure/bip32` (Deno-compatible)
- Address checksum (EIP-55)

## Phase 3 — Reserve Address Endpoint

`bep20-reserve-address` edge function:
- Input: order_id, expected_amount_usd, token (USDT|USDC)
- Atomically increments `next_index`, derives address, stores in `bep20_reserved_addresses` with 30-min expiry
- Returns: address, QR data, expiry, expected amount

Bot flow: user selects "USDT/USDC BEP20" → enters amount → reserve → shows QR + address + countdown.

## Phase 4 — Chain Watcher (auto-verify)

`bep20-watcher` edge function, cron every 30 sec via `pg_cron`:
- `eth_getLogs` on USDT + USDC contracts from `watcher_last_block - 10` (overlap for reorgs) to `latest - 3` (3-conf safety)
- Filter Transfer events where `to` ∈ reserved addresses
- Skip if `(tx_hash, log_index)` already in `bep20_payment_registry`
- Match amount → credit `bot_deposits`, notify Telegram, mark address `paid`
- Overpay → credit actual; underpay → partial credit + keep address open till expiry

## Phase 5 — Auto-Sweep

`bep20-sweep` edge function, cron every 2 min:
- For every `paid` address, sign token `transfer` from that derived key → sweep destination
- Gas paid by hot wallet (index 0)
- Alert admin if hot wallet BNB < min threshold

**Note:** sweep needs the derived private key for each address, so we DO need the account-level xprv (not just xpub) OR we treat each derived index as a separate signer. Spec §2 uses xprv on server for signing sweeps — this is the security tradeoff. Alternative: skip auto-sweep, let funds accumulate; you manually sweep from Trust Wallet by importing the seed. **Recommend: skip auto-sweep in v1**, add later once you're comfortable.

## Phase 6 — Admin Panel

New tab `BEP20 Gateway`:
- Settings form: xpub, sweep destination, gas tank status
- Live table: reserved addresses (pending/paid/expired), amounts, tx links
- Manual "Re-scan" button (force watcher run)
- Gas tank balance card

## Phase 7 — Bot + Web UI

- Add "USDT/USDC BEP20" payment method to `bot_payment_methods` (sort_order after Cryptomus)
- Bot: amount input → reserve address → QR + polling for status
- Web deposit page: same flow

---

## Security decisions

1. **Xpub-only (v1, recommended):** Server never holds seed. Auto-verify works. Auto-sweep NOT possible — you manually sweep occasionally from Trust Wallet.
2. **Xprv on server (v2, optional):** Enables auto-sweep, but xprv leak = all funds gone. Only for dedicated wallet with small balances.

**Question before I build:** v1 (xpub-only, no auto-sweep) or v2 (xprv + auto-sweep)?

If v1 → I don't need private key secret, only xpub. Simpler + safer.
If v2 → you'll add `BSC_SWEEP_XPRV` via secure secret form.

---

## Deliverables

- 3 new tables + migrations with RLS
- 3 edge functions (reserve, watcher, sweep-if-v2)
- pg_cron schedule for watcher
- Admin panel tab
- Bot payment method integration
- Web deposit UI integration

Estimated: full implementation in 1 long session, phase by phase with your confirmation between DB migration and code.

**Confirm: v1 or v2?** Then paste your BSC xpub (I'll open the secure secret form).