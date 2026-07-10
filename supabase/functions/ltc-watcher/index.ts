// LTC watcher — polls litecoinspace.org for incoming txs to reserved addresses.
// Runs on cron (60s). Credits bot_deposits idempotently via ltc_payment_registry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPLORER = "https://litecoinspace.org/api";
const AMOUNT_TOLERANCE = 0.01; // 1% under-pay allowed

interface Vout {
  scriptpubkey_address?: string;
  value: number; // satoshis (litoshis)
}
interface Tx {
  txid: string;
  vout: Vout[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

async function fetchAddressTxs(addr: string): Promise<Tx[]> {
  const r = await fetch(`${EXPLORER}/address/${addr}/txs`);
  if (!r.ok) throw new Error(`explorer ${r.status}`);
  return await r.json();
}

async function fetchTipHeight(): Promise<number> {
  const r = await fetch(`${EXPLORER}/blocks/tip/height`);
  return Number(await r.text());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const summary = { checked: 0, credited: 0, skipped: 0, errors: [] as string[] };

  try {
    // Expire old
    await admin
      .from("ltc_reserved_addresses")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    const { data: settings } = await admin.from("ltc_settings").select("*").eq("singleton", true).single();
    const minConf = Number(settings?.min_confirmations ?? 2);

    // Watch all pending + recently paid (for extra confirmations updates)
    const { data: reserved } = await admin
      .from("ltc_reserved_addresses")
      .select("*")
      .in("status", ["pending"])
      .limit(200);

    if (!reserved || reserved.length === 0) {
      return new Response(JSON.stringify({ ok: true, ...summary, note: "no pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tipHeight = await fetchTipHeight().catch(() => 0);

    for (const row of reserved) {
      summary.checked++;
      try {
        const txs = await fetchAddressTxs(row.address);
        for (const tx of txs) {
          if (!tx.status.confirmed) continue;
          const conf = tipHeight && tx.status.block_height ? tipHeight - tx.status.block_height + 1 : 0;
          if (conf < minConf) continue;

          // Find matching vout to this address
          for (let voutIdx = 0; voutIdx < tx.vout.length; voutIdx++) {
            const v = tx.vout[voutIdx];
            if (v.scriptpubkey_address !== row.address) continue;
            const amountLtc = v.value / 1e8;

            // Idempotency check
            const { data: existing } = await admin
              .from("ltc_payment_registry")
              .select("id")
              .eq("tx_hash", tx.txid)
              .eq("vout", voutIdx)
              .maybeSingle();
            if (existing) { summary.skipped++; continue; }

            const expected = Number(row.expected_amount_ltc);
            const minAcceptable = expected * (1 - AMOUNT_TOLERANCE);
            if (amountLtc < minAcceptable) {
              // Underpay: register but do not credit; keep pending till expiry
              await admin.from("ltc_payment_registry").insert({
                tx_hash: tx.txid, vout: voutIdx, address: row.address,
                amount_ltc: amountLtc, block_height: tx.status.block_height,
                confirmations: conf, reserved_address_id: row.id,
              });
              summary.skipped++;
              continue;
            }

            // Credit: convert to USD at reserved rate (customer paid what they promised in LTC)
            const usdCredited = Number((amountLtc * Number(row.ltc_usd_rate)).toFixed(4));

            let depositId = row.deposit_id as string | null;
            if (depositId) {
              await applyDepositCredit(admin, {
                depositId,
                amountUsd: usdCredited,
                txHash: tx.txid,
                method: "LTC",
                extra: { ltc_address: row.address, ltc_tx_hash: tx.txid, ltc_amount: amountLtc },
              });
            }

            await admin.from("ltc_payment_registry").insert({
              tx_hash: tx.txid, vout: voutIdx, address: row.address,
              amount_ltc: amountLtc, block_height: tx.status.block_height,
              confirmations: conf, reserved_address_id: row.id,
              deposit_id: depositId,
            });

            await admin.from("ltc_reserved_addresses").update({
              status: "paid",
              paid_tx_hash: tx.txid,
              paid_amount_ltc: amountLtc,
              paid_at: new Date().toISOString(),
            }).eq("id", row.id);

            summary.credited++;
          }
        }
      } catch (e) {
        summary.errors.push(`${row.address}: ${(e as Error).message}`);
      }
    }

    if (tipHeight > 0) {
      await admin.from("ltc_settings").update({ watcher_last_height: tipHeight }).eq("singleton", true);
    }

    return new Response(JSON.stringify({ ok: true, ...summary, tipHeight }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ltc-watcher error:", err);
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message ?? err), ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
