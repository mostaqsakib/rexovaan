// Multi-chain auto sweeper with gas-tank monitor.
// For every 'paid' reservation, sweeps USDT/USDC from the derived address
// to BSC_SWEEP_DESTINATION on EVERY chain the reservation actually received
// funds on (see received_chains). Master wallet (index 0) funds gas on each chain.
// Sends admin Telegram alert if master gas balance falls below chain threshold.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6.13.2";
import { deriveAddressWithXprv } from "../_bep20/derive.ts";
import { CHAINS, ChainCfg, getRpcUrl, enabledChains } from "../_bep20/chains.ts";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];
// USDT-BEP20 transfer actual gas usage ≈ 52k, USDC ≈ 55k. 65k gives 15-20% safety margin.
// Unused gas is refunded by the network, but this is the ceiling used to fund the derived
// address — a lower ceiling = less BNB stranded per throwaway address.
const TOKEN_TRANSFER_GAS = 65_000n;
const BNB_TRANSFER_GAS = 21_000n;

async function sendTelegram(method: string, body: Record<string, unknown>) {
  const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {}
}

async function checkGasTank(chain: ChainCfg, master: string, provider: any, supabase: any) {
  const bal: bigint = await provider.getBalance(master);
  if (bal >= chain.minGasNativeWei) return { chain: chain.id, native: chain.nativeSymbol, ok: true, bal: ethers.formatEther(bal) };
  const { data: last } = await supabase.from("evm_gas_alerts").select("last_alerted_at").eq("chain", chain.id).maybeSingle();
  const hoursSince = last ? (Date.now() - new Date(last.last_alerted_at).getTime()) / 3.6e6 : 999;
  if (hoursSince < 6) return { chain: chain.id, native: chain.nativeSymbol, ok: false, bal: ethers.formatEther(bal), throttled: true };
  const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
  if (adminChatId) {
    await sendTelegram("sendMessage", {
      chat_id: adminChatId,
      text: `⛽ <b>Gas Tank LOW — ${chain.name}</b>\n\nMaster: <code>${master}</code>\nBalance: <b>${ethers.formatEther(bal)} ${chain.nativeSymbol}</b>\nMin: <b>${ethers.formatEther(chain.minGasNativeWei)} ${chain.nativeSymbol}</b>\n\n➡️ Top up master wallet to keep sweeps running.`,
      parse_mode: "HTML",
    });
  }
  await supabase.from("evm_gas_alerts").upsert({
    chain: chain.id, last_alerted_at: new Date().toISOString(), last_balance: Number(ethers.formatEther(bal)),
  }, { onConflict: "chain" });
  return { chain: chain.id, native: chain.nativeSymbol, ok: false, bal: ethers.formatEther(bal), alerted: true };
}

async function sweepOnChain(chain: ChainCfg, rows: any[], xprv: string, destination: string, supabase: any, opts: { force: boolean; minUsd: number }) {
  const rpcUrl = getRpcUrl(chain);
  if (!rpcUrl) return { chain: chain.id, skipped: "no rpc" };

  // Only touch this chain if some reservation actually received funds here.
  // Prevents gas-tank alerts for chains the user doesn't use (e.g. Polygon/ETH/AVAX when only BSC is active).
  const relevantRows = rows.filter((row) => {
    const rc: string[] = row.received_chains && row.received_chains.length > 0 ? row.received_chains : ["bsc"];
    return rc.includes(chain.id);
  });
  if (relevantRows.length === 0) return { chain: chain.id, skipped: "no rows for this chain" };

  const provider = new ethers.JsonRpcProvider(rpcUrl, { chainId: chain.chainId, name: chain.name });
  const feeData = await provider.getFeeData();
  // Per-chain minimum gas price floor. BSC accepts as low as 0.1 gwei; public RPCs
  // often over-report the "suggested" price. Use whichever is LOWER: network suggestion
  // or a sane cap for that chain. Small 5% bump for reliable inclusion.
  const chainMinGwei: Record<string, string> = { bsc: "0.1", polygon: "30", arbitrum: "0.01", optimism: "0.001", base: "0.005" };
  const capGwei = chainMinGwei[chain.id] ?? "1";
  const cap = ethers.parseUnits(capGwei, "gwei");
  const suggested = feeData.gasPrice ?? cap;
  const base = suggested < cap ? suggested : cap;
  const gasPrice = (base * 105n) / 100n;
  const tokenGasCost = TOKEN_TRANSFER_GAS * gasPrice;
  const bnbGasCost = BNB_TRANSFER_GAS * gasPrice;
  const gasTopUp = chain.gasTopUpWei > (tokenGasCost * 12n) / 10n ? chain.gasTopUpWei : (tokenGasCost * 12n) / 10n;

  const master = deriveAddressWithXprv(xprv, 0);
  const masterWallet = new ethers.Wallet(master.privateKey, provider);
  const gasStatus = await checkGasTank(chain, master.address, provider, supabase);
  let masterNonce = await provider.getTransactionCount(master.address, "pending");
  const masterBnb: bigint = await provider.getBalance(master.address);


  const results: any[] = [];
  for (const row of rows) {
    // Only sweep chains this reservation actually received on. If null (legacy) assume BSC.
    const receivedChains: string[] = row.received_chains && row.received_chains.length > 0 ? row.received_chains : ["bsc"];
    if (!receivedChains.includes(chain.id)) continue;

    const entry: any = { id: row.id, chain: chain.id, address: row.address, action: "skip" };

    // Threshold guard: skip small deposits unless force=true. Funds stay safe on the derived address.
    const receivedUsd = Number(row.received_amount || 0);
    if (!opts.force && receivedUsd > 0 && receivedUsd < opts.minUsd) {
      entry.action = "deferred_small"; entry.receivedUsd = receivedUsd; entry.threshold = opts.minUsd;
      if (row.sweep_status !== "deferred") {
        await supabase.from("bep20_reserved_addresses").update({
          sweep_status: "deferred",
          sweep_last_error: `Below threshold: $${receivedUsd.toFixed(2)} < $${opts.minUsd.toFixed(2)}`,
        }).eq("id", row.id);
      }
      results.push(entry);
      continue;
    }

    try {
      const derived = deriveAddressWithXprv(xprv, row.derivation_index);
      if (derived.address.toLowerCase() !== String(row.address).toLowerCase()) throw new Error("derivation mismatch");
      const derivedWallet = new ethers.Wallet(derived.privateKey, provider);

      // Try each token on this chain
      let picked: { tok: any; bal: bigint } | null = null;
      for (const tok of chain.tokens) {
        const c = new ethers.Contract(tok.address, ERC20_ABI, provider);
        const bal: bigint = await c.balanceOf(derived.address);
        if (bal > 0n) { picked = { tok, bal }; break; }
      }
      if (!picked) { entry.action = "no_balance"; results.push(entry); continue; }

      const derivedNative: bigint = await provider.getBalance(derived.address);
      if (derivedNative < tokenGasCost) {
        if (masterBnb < gasTopUp + bnbGasCost) {
          entry.action = "master_underfunded"; entry.masterBnb = ethers.formatEther(masterBnb);
          results.push(entry); continue;
        }
        const tx = await masterWallet.sendTransaction({
          to: derived.address, value: gasTopUp, gasLimit: BNB_TRANSFER_GAS, gasPrice, nonce: masterNonce++,
        });
        entry.action = "gas_funded"; entry.gasTx = tx.hash;
        results.push(entry); continue;
      }

      const tokenContract = new ethers.Contract(picked.tok.address, ERC20_ABI, derivedWallet);
      const nonce = await provider.getTransactionCount(derived.address, "pending");
      const txResp = await tokenContract.transfer(destination, picked.bal, { gasLimit: TOKEN_TRANSFER_GAS, gasPrice, nonce });
      entry.action = "swept";
      entry.token = picked.tok.symbol;
      entry.amount = ethers.formatUnits(picked.bal, picked.tok.decimals);
      entry.tx = txResp.hash;
      entry.explorer = chain.explorerTx(txResp.hash);
      results.push(entry);

      // Only update reservation-level sweep status if this is the reservation's primary chain
      // (avoid overwriting when sweeping across multiple chains for one reservation).
      if (receivedChains.length === 1) {
        await supabase.from("bep20_reserved_addresses").update({
          sweep_status: "swept", sweep_tx_hash: txResp.hash, swept_at: new Date().toISOString(),
          sweep_last_try_at: new Date().toISOString(), sweep_attempts: (row.sweep_attempts ?? 0) + 1, sweep_last_error: null,
        }).eq("id", row.id);
      }
    } catch (e) {
      console.error(`[${chain.id}] sweep row error`, row.id, e);
      entry.action = "error"; entry.error = String((e as Error).message ?? e);
      await supabase.from("bep20_reserved_addresses").update({
        sweep_status: "error", sweep_last_error: String((e as Error).message ?? e).slice(0, 400),
        sweep_last_try_at: new Date().toISOString(), sweep_attempts: (row.sweep_attempts ?? 0) + 1,
      }).eq("id", row.id);
      results.push(entry);
    }
  }
  return { chain: chain.id, master: master.address, gasStatus, gasPrice: ethers.formatUnits(gasPrice, "gwei") + " gwei", results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Parse force flag (from body OR ?force=1) — force=true bypasses the small-deposit threshold
    // and also re-picks previously deferred rows.
    let force = false;
    try {
      const url = new URL(req.url);
      if (url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true") force = true;
      if (req.method !== "GET") {
        const body = await req.json().catch(() => ({}));
        if (body && (body.force === true || body.force === "true" || body.force === 1)) force = true;
      }
    } catch { /* ignore */ }

    const minUsd = Number(Deno.env.get("SWEEP_MIN_USD_BEP20") ?? "0.5");

    const xprv = Deno.env.get("BSC_SWEEP_XPRV") || Deno.env.get("BSC_XPRV");
    const destination = Deno.env.get("BSC_SWEEP_DESTINATION");
    if (!xprv) return json({ error: "BSC_SWEEP_XPRV not configured" }, 500);
    if (!destination) return json({ error: "BSC_SWEEP_DESTINATION not configured" }, 500);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Include 'deferred' rows when force=true so manual batch sweep catches all accumulated small amounts.
    const orFilter = force
      ? "sweep_status.is.null,sweep_status.eq.needs_gas,sweep_status.eq.error,sweep_status.eq.deferred"
      : "sweep_status.is.null,sweep_status.eq.needs_gas,sweep_status.eq.error";

    const { data: rows, error: rowsErr } = await supabase
      .from("bep20_reserved_addresses")
      .select("id, address, derivation_index, token, received_amount, received_chains, sweep_status, sweep_attempts")
      .eq("status", "paid")
      .or(orFilter)
      .lt("sweep_attempts", 8)
      .order("paid_at", { ascending: true })
      .limit(force ? 100 : 20);
    if (rowsErr) throw rowsErr;
    if (!rows || rows.length === 0) return json({ ok: true, processed: 0, force, minUsd });

    const chains = enabledChains();
    if (chains.length === 0) return json({ error: "no chains configured" }, 500);

    const results = await Promise.all(chains.map((c) =>
      sweepOnChain(c, rows, xprv, destination, supabase, { force, minUsd }).catch((e) => ({ chain: c.id, error: (e as Error).message })),
    ));

    return json({ ok: true, destination, processed: rows.length, force, minUsd, chains: results });
  } catch (e) {
    console.error("bep20-sweep fatal", e);
    return json({ error: (e as Error).message }, 500);
  }
});
