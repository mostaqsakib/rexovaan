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
    let credited = 0, scanned = 0;
    const contracts = Object.values(BEP20_TOKENS).map((t) => t.address);

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

    for (let start = fromBlock; start <= safeTo; start += MAX_RANGE + 1) {
      const end = Math.min(start + MAX_RANGE, safeTo);
      const logs: any[] = await rpc(rpcUrl, "eth_getLogs", [{
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
        address: contracts,
        topics: [TRANSFER_TOPIC, null, toAddrTopics],
      }]);
      scanned += end - start + 1;

      for (const log of logs) {
        const contract = log.address.toLowerCase();
        const tok = tokenByContract(contract);
        if (!tok) continue;
        const toAddr = topicAddressToHex(log.topics[2]);
        const res = resByAddr.get(toAddr);
        if (!res) continue;
        if (res.token !== "ANY" && res.token !== tok.symbol) continue;

        const rawAmt = hexToBigInt(log.data);
        const amt = formatUnits(rawAmt, tok.decimals);
        const txHash = log.transactionHash;
        const logIndex = Number(hexToBigInt(log.logIndex));
        const blockNumber = Number(hexToBigInt(log.blockNumber));

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
        try {
          await applyDepositCredit(supabase, res.customer_id, amt);
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

        credited++;
      }
    }

    await supabase.from("bep20_settings").update({ watcher_last_block: safeTo }).eq("id", 1);

    // Expire old pending reservations
    await supabase.from("bep20_reserved_addresses")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    return json({ ok: true, scanned, credited, latest, safeTo, fromBlock });
  } catch (e) {
    console.error("watcher error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
