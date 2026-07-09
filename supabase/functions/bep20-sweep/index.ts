// BEP20 Auto Sweeper
// For every 'paid' reservation, sweeps USDT/USDC from the derived address
// to BSC_SWEEP_DESTINATION. If the derived address has no BNB for gas,
// funds it from the master wallet (derivation index 0).
//
// Two-phase per address (across cron runs):
//   1. sweep_status = null           -> if no BNB: send gas TX, mark 'needs_gas'
//                                    -> if BNB ok: send token TX, mark 'swept'
//   2. sweep_status = 'needs_gas'    -> next run detects BNB arrived, sweeps.
//
// Runs via pg_cron every 2 minutes.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6.13.2";
import { deriveAddressWithXprv, BEP20_TOKENS } from "../_bep20/derive.ts";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];

// Gas budget per USDT transfer (BEP20 USDT uses ~55k). Add headroom.
const TOKEN_TRANSFER_GAS = 90_000n;
// Small buffer for BNB transfer itself (21k).
const BNB_TRANSFER_GAS = 21_000n;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const rpcUrl = Deno.env.get("BSC_RPC_URL");
    const xprv = Deno.env.get("BSC_SWEEP_XPRV") || Deno.env.get("BSC_XPRV");
    const destination = Deno.env.get("BSC_SWEEP_DESTINATION");
    if (!rpcUrl) return json({ error: "BSC_RPC_URL not configured" }, 500);
    if (!xprv) return json({ error: "BSC_SWEEP_XPRV not configured" }, 500);
    if (!destination) return json({ error: "BSC_SWEEP_DESTINATION not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const provider = new ethers.JsonRpcProvider(rpcUrl, { chainId: 56, name: "bsc" });
    const feeData = await provider.getFeeData();
    // BSC gas price ~1-5 gwei. Use 1.1x safety.
    const gasPrice = ((feeData.gasPrice ?? ethers.parseUnits("1", "gwei")) * 11n) / 10n;
    const tokenGasCost = TOKEN_TRANSFER_GAS * gasPrice;
    const bnbGasCost = BNB_TRANSFER_GAS * gasPrice;
    // Fund derived addresses with a bit more than needed so re-orgs / slippage don't strand them.
    const gasTopUp = (tokenGasCost * 12n) / 10n;

    // Master funder = index 0
    const master = deriveAddressWithXprv(xprv, 0);
    const masterWallet = new ethers.Wallet(master.privateKey, provider);
    const masterBnb = await provider.getBalance(master.address);

    // Fetch candidates: paid, not yet swept
    const { data: rows, error: rowsErr } = await supabase
      .from("bep20_reserved_addresses")
      .select("id, address, derivation_index, token, received_amount, sweep_status, sweep_attempts")
      .eq("status", "paid")
      .or("sweep_status.is.null,sweep_status.eq.needs_gas,sweep_status.eq.error")
      .lt("sweep_attempts", 8)
      .order("paid_at", { ascending: true })
      .limit(15);
    if (rowsErr) throw rowsErr;

    const results: any[] = [];
    let masterNonce = await provider.getTransactionCount(master.address, "pending");

    for (const row of rows ?? []) {
      const entry: any = { id: row.id, address: row.address, action: "skip" };
      try {
        const derived = deriveAddressWithXprv(xprv, row.derivation_index);
        if (derived.address.toLowerCase() !== String(row.address).toLowerCase()) {
          throw new Error("derivation mismatch");
        }
        const derivedWallet = new ethers.Wallet(derived.privateKey, provider);

        // Which token(s) to sweep? If token='ANY', try both.
        const symbols: (keyof typeof BEP20_TOKENS)[] =
          row.token === "ANY" ? ["USDT", "USDC"] : [row.token as any];

        // Find first token with balance
        let tokenSym: keyof typeof BEP20_TOKENS | null = null;
        let tokenBal = 0n;
        for (const s of symbols) {
          const c = new ethers.Contract(BEP20_TOKENS[s].address, ERC20_ABI, provider);
          const bal: bigint = await c.balanceOf(derived.address);
          if (bal > 0n) { tokenSym = s; tokenBal = bal; break; }
        }
        if (!tokenSym || tokenBal === 0n) {
          await supabase.from("bep20_reserved_addresses").update({
            sweep_status: "no_balance",
            sweep_last_try_at: new Date().toISOString(),
            sweep_attempts: (row.sweep_attempts ?? 0) + 1,
          }).eq("id", row.id);
          entry.action = "no_balance";
          results.push(entry);
          continue;
        }

        const derivedBnb = await provider.getBalance(derived.address);

        if (derivedBnb < tokenGasCost) {
          // Need to fund gas from master
          if (masterBnb < gasTopUp + bnbGasCost) {
            entry.action = "master_underfunded";
            entry.masterBnb = ethers.formatEther(masterBnb);
            entry.need = ethers.formatEther(gasTopUp);
            await supabase.from("bep20_reserved_addresses").update({
              sweep_status: "error",
              sweep_last_error: "master wallet BNB too low for gas",
              sweep_last_try_at: new Date().toISOString(),
              sweep_attempts: (row.sweep_attempts ?? 0) + 1,
            }).eq("id", row.id);
            results.push(entry);
            continue;
          }
          const tx = await masterWallet.sendTransaction({
            to: derived.address,
            value: gasTopUp,
            gasLimit: BNB_TRANSFER_GAS,
            gasPrice,
            nonce: masterNonce++,
          });
          await supabase.from("bep20_reserved_addresses").update({
            sweep_status: "needs_gas",
            gas_tx_hash: tx.hash,
            sweep_last_try_at: new Date().toISOString(),
            sweep_attempts: (row.sweep_attempts ?? 0) + 1,
            sweep_last_error: null,
          }).eq("id", row.id);
          entry.action = "gas_funded";
          entry.gasTx = tx.hash;
          results.push(entry);
          continue;
        }

        // Have gas, send token transfer
        const tokenContract = new ethers.Contract(BEP20_TOKENS[tokenSym].address, ERC20_ABI, derivedWallet);
        const nonce = await provider.getTransactionCount(derived.address, "pending");
        const txResp = await tokenContract.transfer(destination, tokenBal, {
          gasLimit: TOKEN_TRANSFER_GAS,
          gasPrice,
          nonce,
        });
        await supabase.from("bep20_reserved_addresses").update({
          sweep_status: "swept",
          sweep_tx_hash: txResp.hash,
          swept_at: new Date().toISOString(),
          sweep_last_try_at: new Date().toISOString(),
          sweep_attempts: (row.sweep_attempts ?? 0) + 1,
          sweep_last_error: null,
        }).eq("id", row.id);
        entry.action = "swept";
        entry.token = tokenSym;
        entry.amount = ethers.formatUnits(tokenBal, BEP20_TOKENS[tokenSym].decimals);
        entry.tx = txResp.hash;
        results.push(entry);
      } catch (e) {
        console.error("sweep row error", row.id, e);
        await supabase.from("bep20_reserved_addresses").update({
          sweep_status: "error",
          sweep_last_error: String((e as Error).message ?? e).slice(0, 400),
          sweep_last_try_at: new Date().toISOString(),
          sweep_attempts: (row.sweep_attempts ?? 0) + 1,
        }).eq("id", row.id);
        entry.action = "error";
        entry.error = String((e as Error).message ?? e);
        results.push(entry);
      }
    }

    return json({
      ok: true,
      processed: results.length,
      master: master.address,
      masterBnb: ethers.formatEther(masterBnb),
      gasPrice: ethers.formatUnits(gasPrice, "gwei") + " gwei",
      destination,
      results,
    });
  } catch (e) {
    console.error("bep20-sweep fatal", e);
    return json({ error: (e as Error).message }, 500);
  }
});
