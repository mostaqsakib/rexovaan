// BEP20 chain watcher. Scans BSC for Transfer events into reserved addresses,
// credits the deposit atomically (idempotent via bep20_payment_registry).
// Triggered by pg_cron every 30s (or on-demand).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BEP20_TOKENS,
  TRANSFER_TOPIC,
  topicAddressToHex,
  hexToBigInt,
  formatUnits,
  tokenByContract,
} from "../_bep20/derive.ts";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

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
  if (!BOT_TOKEN) {
    console.warn("[BEP20 watcher] BOT_TOKEN missing, skipping Telegram notify");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[BEP20 watcher] Telegram ${method} failed [${res.status}]: ${txt}`);
    }
  } catch (e) {
    console.error(`[BEP20 watcher] Telegram ${method} error:`, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const rpcUrl = Deno.env.get("BSC_RPC_URL");
    if (!rpcUrl) return json({ error: "BSC_RPC_URL not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("bep20_settings")
      .select("watcher_last_block, confirmations_required")
      .eq("id", 1)
      .single();
    if (!settings) return json({ error: "settings missing" }, 500);

    const confReq = settings.confirmations_required ?? 3;
    const latestHex = await rpc(rpcUrl, "eth_blockNumber", []);
    const latest = Number(hexToBigInt(latestHex));
    const safeTo = latest - confReq;
    let fromBlock = Number(settings.watcher_last_block || 0);
    if (fromBlock === 0) fromBlock = safeTo - 100; // first run: last ~100 blocks
    else fromBlock = Math.max(0, fromBlock - 10); // 10-block overlap for reorgs
    if (fromBlock > safeTo) return json({ ok: true, scanned: 0, latest, safeTo, fromBlock });

    // BSC RPC limits ~5000 blocks per getLogs — chunk if needed
    const MAX_RANGE = 4000;
    let credited = 0, scanned = 0, fakes = 0;
    const knownContracts = new Set(
      Object.values(BEP20_TOKENS).map((t) => t.address.toLowerCase()),
    );

    // Get active pending reservations (limit for perf)
    const { data: reservations } = await supabase
      .from("bep20_reserved_addresses")
      .select("id, address, token, expected_amount, status, customer_id, deposit_id, received_amount")
      .in("status", ["pending", "paid"])
      .limit(500);
    const resByAddr = new Map<string, any>();
    for (const r of reservations ?? []) resByAddr.set(r.address.toLowerCase(), r);

    if (resByAddr.size === 0) {
      await supabase.from("bep20_settings").update({ watcher_last_block: safeTo }).eq("id", 1);
      return json({ ok: true, scanned: 0, latest, safeTo, note: "no reservations" });
    }

    const toAddrTopics = Array.from(resByAddr.keys()).map(
      (a) => "0x" + a.replace(/^0x/, "").padStart(64, "0"),
    );

    // Cache token symbols for unknown contracts (per invocation)
    const symbolCache = new Map<string, string | null>();
    async function fetchSymbol(contract: string): Promise<string | null> {
      if (symbolCache.has(contract)) return symbolCache.get(contract)!;
      try {
        const res = await rpc(rpcUrl, "eth_call", [{ to: contract, data: "0x95d89b41" }, "latest"]);
        if (!res || res === "0x") { symbolCache.set(contract, null); return null; }
        const hex = res.replace(/^0x/, "");
        let out: string | null = null;
        if (hex.length >= 128) {
          const len = parseInt(hex.slice(64, 128), 16);
          const chars = hex.slice(128, 128 + len * 2);
          let sym = "";
          for (let i = 0; i < chars.length; i += 2) sym += String.fromCharCode(parseInt(chars.slice(i, i + 2), 16));
          out = sym.replace(/[^\x20-\x7e\u00a0-\uffff]/g, "").trim().slice(0, 32) || null;
        }
        if (!out) {
          let sym2 = "";
          for (let i = 0; i < 64; i += 2) {
            const c = parseInt(hex.slice(i, i + 2), 16);
            if (c > 0) sym2 += String.fromCharCode(c);
          }
          out = sym2.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 32) || null;
        }
        symbolCache.set(contract, out);
        return out;
      } catch {
        symbolCache.set(contract, null);
        return null;
      }
    }

    for (let start = fromBlock; start <= safeTo; start += MAX_RANGE + 1) {
      const end = Math.min(start + MAX_RANGE, safeTo);
      // Scan ALL ERC20 Transfer events into reserved addresses (no contract filter),
      // then classify real (whitelisted BEP20) vs. fake/unsupported tokens.
      const logs: any[] = await rpc(rpcUrl, "eth_getLogs", [{
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
        topics: [TRANSFER_TOPIC, null, toAddrTopics],
      }]);
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

        // Not a whitelisted stablecoin → log as FAKE and skip credit
        if (!knownContracts.has(contract)) {
          const symbol = await fetchSymbol(contract);
          const amtFake = Number(formatUnits(rawAmt, 18));
          const { error: fErr } = await supabase.from("bep20_fake_transactions").insert({
            tx_hash: txHash,
            log_index: logIndex,
            address: toAddr,
            contract,
            token_symbol: symbol,
            amount: amtFake,
            raw_amount: rawAmt.toString(),
            from_address: fromAddr,
            block_number: blockNumber,
            reserved_address_id: res.id,
            customer_id: res.customer_id,
            deposit_id: res.deposit_id,
            reason: "fake_token_detected",
          });
          if (fErr && (fErr as any).code !== "23505") {
            console.error("fake insert err", fErr);
          } else if (!fErr) {
            fakes++;
          }
          continue;
        }

        const tok = tokenByContract(contract);
        if (!tok) continue;
        if (res.token !== "ANY" && res.token !== tok.symbol) continue;

        const amt = formatUnits(rawAmt, tok.decimals);


        // Idempotency insert
        const { error: regErr } = await supabase.from("bep20_payment_registry").insert({
          tx_hash: txHash,
          log_index: logIndex,
          address: toAddr,
          token: tok.symbol,
          amount: amt,
          block_number: blockNumber,
          reserved_address_id: res.id,
          deposit_id: res.deposit_id,
        });
        if (regErr) {
          if ((regErr as any).code === "23505") continue; // already credited
          console.error("registry insert err", regErr);
          continue;
        }

        // Credit the customer
        let creditResult: { newBalance: number; paidPayLater: number } | null = null;
        try {
          creditResult = await applyDepositCredit(supabase, res.customer_id, amt);
        } catch (e) {
          console.error("applyDepositCredit err", e);
        }

        // Update deposit + reservation
        const { error: depUpdErr } = await supabase.from("bot_deposits").update({
          status: "verified",
          verified_at: new Date().toISOString(),
          bep20_tx_hash: txHash,
          bep20_token: tok.symbol,
          txn_hash: txHash,
        } as any).eq("id", res.deposit_id);
        if (depUpdErr) console.error("bot_deposits update err", depUpdErr);

        const newReceived = Number(res.received_amount || 0) + amt;
        await supabase.from("bep20_reserved_addresses").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          tx_hash: txHash,
          received_amount: newReceived,
        }).eq("id", res.id);

        // Notify customer + admin
        try {
          const { data: customer } = await supabase
            .from("bot_customers")
            .select("chat_id")
            .eq("id", res.customer_id)
            .maybeSingle();
          const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
          if (customer?.chat_id) {
            const plLine = creditResult && creditResult.paidPayLater > 0
              ? `\n🏷️ Pay-Later Cleared: <b>$${creditResult.paidPayLater.toFixed(2)}</b>` : "";
            const balLine = creditResult
              ? `\n💳 New Balance: <b>$${creditResult.newBalance.toFixed(2)} USDT</b>` : "";
            await sendTelegram("sendMessage", {
              chat_id: customer.chat_id,
              text: `✅ <b>BEP20 Deposit Verified!</b>\n\n💵 Credited: <b>${amt.toFixed(2)} ${tok.symbol}</b>${plLine}${balLine}\n🔗 Tx: <code>${shortTx}</code>`,
              parse_mode: "HTML",
            });
          }
          const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
          if (adminChatId) {
            await sendTelegram("sendMessage", {
              chat_id: adminChatId,
              text: `💰 <b>BEP20 Deposit Received</b>\n\nCustomer: <code>${customer?.chat_id || res.customer_id}</code>\nAmount: <b>${amt.toFixed(2)} ${tok.symbol}</b>\nAddress: <code>${toAddr}</code>\nTx: <code>${txHash}</code>`,
              parse_mode: "HTML",
            });
          }
        } catch (e) {
          console.error("notify err", e);
        }

        credited++;
      }
    }

    await supabase.from("bep20_settings").update({ watcher_last_block: safeTo }).eq("id", 1);

    // Expire old pending reservations
    await supabase.from("bep20_reserved_addresses")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    return json({ ok: true, scanned, credited, fakes, latest, safeTo, fromBlock });
  } catch (e) {
    console.error("watcher error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
