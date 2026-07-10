// Multi-chain EVM watcher.
// - Loops over every chain that has an RPC configured (see chains.ts).
// - For each chain: scans Transfer events into reserved addresses,
//   credits real USDT/USDC on any chain (wrong-network recovery),
//   logs unknown-token spam as fake.
// - Idempotent via UNIQUE(chain, tx_hash, log_index) on bep20_payment_registry.
//
// Same reserved address works on every EVM chain because HD-derived
// secp256k1 keys → identical EVM addresses across chains.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";
import {
  CHAINS,
  ChainCfg,
  enabledChains,
  getRpcUrl,
  TRANSFER_TOPIC,
  topicAddressToHex,
  hexToBigInt,
  formatUnits,
  tokenByContract,
  padTopicAddress,
} from "../_bep20/chains.ts";

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function sendTelegram(method: string, body: Record<string, unknown>) {
  const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("telegram err", e);
  }
}

async function fetchSymbol(rpcUrl: string, contract: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(contract)) return cache.get(contract)!;
  try {
    const res = await rpc(rpcUrl, "eth_call", [{ to: contract, data: "0x95d89b41" }, "latest"]);
    if (!res || res === "0x") { cache.set(contract, null); return null; }
    const hex = res.replace(/^0x/, "");
    let out: string | null = null;
    if (hex.length >= 128) {
      const len = parseInt(hex.slice(64, 128), 16);
      const chars = hex.slice(128, 128 + len * 2);
      let sym = "";
      for (let i = 0; i < chars.length; i += 2) sym += String.fromCharCode(parseInt(chars.slice(i, i + 2), 16));
      out = sym.replace(/[^\x20-\x7e\u00a0-\uffff]/g, "").trim().slice(0, 32) || null;
    }
    cache.set(contract, out);
    return out;
  } catch {
    cache.set(contract, null);
    return null;
  }
}

async function scanChain(chain: ChainCfg, supabase: any, reservations: any[], override?: { fromBlock?: number; skipStateWrite?: boolean }) {
  const rpcUrl = getRpcUrl(chain);
  if (!rpcUrl) return { chain: chain.id, skipped: "no rpc" };

  const { data: state } = await supabase
    .from("evm_chain_state")
    .select("*")
    .eq("chain", chain.id)
    .maybeSingle();
  if (state && state.enabled === false) return { chain: chain.id, skipped: "disabled" };

  const confReq = state?.confirmations ?? chain.confirmations;
  const chunkMax = state?.chunk_size ?? chain.chunkSize;

  let latest: number;
  try {
    latest = Number(hexToBigInt(await rpc(rpcUrl, "eth_blockNumber", [])));
  } catch (e) {
    if (!override?.skipStateWrite) {
      await supabase.from("evm_chain_state").upsert({
        chain: chain.id, last_error: `blockNumber: ${(e as Error).message}`, last_run_at: new Date().toISOString(),
      }, { onConflict: "chain" });
    }
    return { chain: chain.id, error: (e as Error).message };
  }

  const safeTo = latest - confReq;
  let fromBlock = override?.fromBlock ?? Number(state?.last_block || 0);
  if (override?.fromBlock === undefined) {
    if (fromBlock === 0) fromBlock = safeTo - 200;
    else fromBlock = Math.max(0, fromBlock - 10);
  }
  if (fromBlock > safeTo) {
    if (!override?.skipStateWrite) {
      await supabase.from("evm_chain_state").upsert({
        chain: chain.id, last_run_at: new Date().toISOString(), last_error: null,
      }, { onConflict: "chain" });
    }
    return { chain: chain.id, scanned: 0, latest };
  }


  const knownContracts = new Set(chain.tokens.map((t) => t.address.toLowerCase()));
  const resByAddr = new Map<string, any>();
  for (const r of reservations) resByAddr.set(r.address.toLowerCase(), r);
  const toAddrTopics = Array.from(resByAddr.keys()).map(padTopicAddress);

  const symbolCache = new Map<string, string | null>();
  let credited = 0, fakes = 0, scanned = 0;

  for (let start = fromBlock; start <= safeTo; start += chunkMax + 1) {
    const end = Math.min(start + chunkMax, safeTo);
    let logs: any[] = [];
    try {
      logs = await rpc(rpcUrl, "eth_getLogs", [{
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
        topics: [TRANSFER_TOPIC, null, toAddrTopics],
      }]);
    } catch (e) {
      console.error(`[${chain.id}] getLogs failed`, e);
      break;
    }
    scanned += end - start + 1;

    for (const log of logs) {
      const contract = log.address.toLowerCase();
      const toAddr = topicAddressToHex(log.topics[2]);
      const res = resByAddr.get(toAddr);
      if (!res) continue;

      const txHash = log.transactionHash;
      const logIndex = Number(hexToBigInt(log.logIndex));
      const blockNumber = Number(hexToBigInt(log.blockNumber));
      const fromAddr = topicAddressToHex(log.topics[1]);
      const rawAmt = hexToBigInt(log.data);

      if (!knownContracts.has(contract)) {
        const symbol = await fetchSymbol(rpcUrl, contract, symbolCache);
        const amtFake = Number(formatUnits(rawAmt, 18));
        const { error: fErr } = await supabase.from("bep20_fake_transactions").insert({
          tx_hash: txHash, log_index: logIndex, address: toAddr, contract, token_symbol: symbol,
          amount: amtFake, raw_amount: rawAmt.toString(), from_address: fromAddr,
          block_number: blockNumber, reserved_address_id: res.id, customer_id: res.customer_id,
          deposit_id: res.deposit_id, reason: "fake_token_detected", chain: chain.id,
        } as any);
        if (!fErr) fakes++;
        continue;
      }

      const tok = tokenByContract(chain, contract);
      if (!tok) continue;
      if (res.token !== "ANY" && res.token !== tok.symbol) continue;

      const amt = formatUnits(rawAmt, tok.decimals);

      const { error: regErr } = await supabase.from("bep20_payment_registry").insert({
        tx_hash: txHash, log_index: logIndex, address: toAddr, token: tok.symbol,
        amount: amt, block_number: blockNumber, reserved_address_id: res.id,
        deposit_id: res.deposit_id, chain: chain.id,
      } as any);
      if (regErr) {
        if ((regErr as any).code === "23505") continue;
        console.error(`[${chain.id}] registry insert err`, regErr);
        continue;
      }

      const isLate = res.status === "expired" || res.status === "rejected";

      let creditResult: { newBalance: number; paidPayLater: number } | null = null;
      if (!isLate) {
        try {
          creditResult = await applyDepositCredit(supabase, res.customer_id, amt);
        } catch (e) {
          console.error(`[${chain.id}] applyDepositCredit err`, e);
        }

        await supabase.from("bot_deposits").update({
          status: "verified",
          verified_at: new Date().toISOString(),
          amount: amt,
          bep20_tx_hash: txHash,
          bep20_token: tok.symbol,
          txn_hash: txHash,
        } as any).eq("id", res.deposit_id);
      } else {
        // Late payment — arrived after reservation expired. Flag for admin review, no auto-credit.
        await supabase.from("bot_deposits").update({
          status: "late_pending",
          amount: amt,
          bep20_tx_hash: txHash,
          bep20_token: tok.symbol,
          txn_hash: txHash,
        } as any).eq("id", res.deposit_id);
      }

      // Merge chain into received_chains
      const rcSet = new Set<string>(res.received_chains ?? []);
      rcSet.add(chain.id);
      const newReceived = Number(res.received_amount || 0) + amt;
      await supabase.from("bep20_reserved_addresses").update({
        status: isLate ? "late_paid" : "paid",
        paid_at: new Date().toISOString(),
        tx_hash: txHash,
        received_amount: newReceived,
        received_chains: Array.from(rcSet),
      }).eq("id", res.id);
      res.received_chains = Array.from(rcSet);
      res.received_amount = newReceived;

      credited++;

      try {
        const { data: customer } = await supabase
          .from("bot_customers").select("chat_id").eq("id", res.customer_id).maybeSingle();
        const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
        const wrongNet = res.token !== "ANY" && !res.received_chains?.includes("bsc") && chain.id !== "bsc";
        const chainLabel = chain.name;
        const adminChatId = Deno.env.get("ADMIN_CHAT_ID");

        if (isLate) {
          if (customer?.chat_id) {
            await sendTelegram("sendMessage", {
              chat_id: customer.chat_id,
              text: `⏰ <b>Late Payment Detected</b>\n\n💵 Amount: <b>${amt.toFixed(2)} ${tok.symbol}</b>\n🌐 Network: <b>${chainLabel}</b>\n\nYour payment arrived after the checkout window expired. Our team has been notified and will credit your account shortly.\n\n🔗 <a href="${chain.explorerTx(txHash)}">Tx: ${shortTx}</a>`,
              parse_mode: "HTML",
            });
          }
          if (adminChatId) {
            await sendTelegram("sendMessage", {
              chat_id: adminChatId,
              text: `⏰ <b>LATE PAYMENT (${chainLabel})</b>\n⚠️ Needs manual credit in admin panel.\n\nCustomer: <code>${customer?.chat_id || res.customer_id}</code>\nAmount: <b>${amt.toFixed(2)} ${tok.symbol}</b>\nAddress: <code>${toAddr}</code>\nDeposit: <code>${res.deposit_id}</code>\n<a href="${chain.explorerTx(txHash)}">Tx: ${txHash}</a>`,
              parse_mode: "HTML",
            });
          }
        } else {
          if (customer?.chat_id) {
            const plLine = creditResult && creditResult.paidPayLater > 0
              ? `\n🏷️ Pay-Later Cleared: <b>$${creditResult.paidPayLater.toFixed(2)}</b>` : "";
            const balLine = creditResult
              ? `\n💳 New Balance: <b>$${creditResult.newBalance.toFixed(2)} USDT</b>` : "";
            const netLine = `\n🌐 Network: <b>${chainLabel}</b>${wrongNet ? " ⚠️ (recovered)" : ""}`;
            await sendTelegram("sendMessage", {
              chat_id: customer.chat_id,
              text: `✅ <b>Deposit Verified!</b>\n\n💵 Credited: <b>${amt.toFixed(2)} ${tok.symbol}</b>${netLine}${plLine}${balLine}\n🔗 <a href="${chain.explorerTx(txHash)}">Tx: ${shortTx}</a>`,
              parse_mode: "HTML",
            });
          }
          if (adminChatId) {
            await sendTelegram("sendMessage", {
              chat_id: adminChatId,
              text: `💰 <b>Deposit Received (${chainLabel})</b>${wrongNet ? "\n⚠️ WRONG NETWORK RECOVERY" : ""}\n\nCustomer: <code>${customer?.chat_id || res.customer_id}</code>\nAmount: <b>${amt.toFixed(2)} ${tok.symbol}</b>\nAddress: <code>${toAddr}</code>\n<a href="${chain.explorerTx(txHash)}">Tx: ${txHash}</a>`,
              parse_mode: "HTML",
            });
          }
        }
      } catch (e) { console.error("notify err", e); }
    }
  }

  if (!override?.skipStateWrite) {
    await supabase.from("evm_chain_state").upsert({
      chain: chain.id,
      last_block: safeTo,
      last_run_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: "chain" });
  }

  return { chain: chain.id, scanned, credited, fakes, latest, safeTo, fromBlock };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional overrides for manual re-scan: ?chain=polygon&from_block=89952380
    const url = new URL(req.url);
    const onlyChain = url.searchParams.get("chain");
    const fromBlockParam = url.searchParams.get("from_block");
    const overrideFromBlock = fromBlockParam ? Number(fromBlockParam) : undefined;

    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reservations } = await supabase
      .from("bep20_reserved_addresses")
      .select("id, address, token, expected_amount, status, customer_id, deposit_id, received_amount, received_chains")
      .in("status", ["pending", "paid", "expired", "rejected"])
      .gte("created_at", cutoffIso)
      .limit(500);
    if (!reservations || reservations.length === 0) {
      return json({ ok: true, note: "no reservations" });
    }

    let chains = enabledChains();
    if (onlyChain) chains = chains.filter((c) => c.id === onlyChain);
    if (chains.length === 0) return json({ error: "no chains matched" }, 400);

    const override = overrideFromBlock !== undefined ? { fromBlock: overrideFromBlock, skipStateWrite: true } : undefined;

    // Scan chains in parallel — each has independent watermark
    const results = await Promise.all(chains.map((c) => scanChain(c, supabase, reservations, override).catch((e) => ({ chain: c.id, error: (e as Error).message }))));
    return json({ ok: true, chains: results });

  } catch (e) {
    console.error("watcher fatal", e);
    return json({ error: (e as Error).message }, 500);
  }
});
