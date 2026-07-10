// LTC auto-sweep — moves funds from paid derived addresses to master wallet.
// Runs on cron every 2 min. Idempotent via sweep_status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { deriveLtcPrivateKey, buildAndSignSweep, type Utxo } from "../_ltc/sign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPLORER = "https://litecoinspace.org/api";
const DUST_THRESHOLD_SATS = 5000; // ~$0.002 — skip sweeping tiny amounts

async function fetchUtxos(addr: string): Promise<Utxo[]> {
  const r = await fetch(`${EXPLORER}/address/${addr}/utxo`);
  if (!r.ok) throw new Error(`utxo fetch ${r.status}`);
  const arr = await r.json() as Array<{ txid: string; vout: number; value: number; status: { confirmed: boolean } }>;
  return arr.filter((u) => u.status.confirmed).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
}

async function fetchFeeRate(): Promise<number> {
  try {
    const r = await fetch(`${EXPLORER}/v1/fees/recommended`);
    if (r.ok) {
      const j = await r.json();
      return Math.max(1, Number(j.halfHourFee ?? j.hourFee ?? 2));
    }
  } catch { /* fall through */ }
  return 2;
}

async function broadcast(txHex: string): Promise<string> {
  const r = await fetch(`${EXPLORER}/tx`, { method: "POST", body: txHex });
  const text = await r.text();
  if (!r.ok) throw new Error(`broadcast ${r.status}: ${text}`);
  return text.trim();
}

async function sendTelegram(method: string, body: Record<string, unknown>) {
  const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (e) { console.error("tg err", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const xprv = Deno.env.get("LTC_XPRV");
  const destAddress = Deno.env.get("LTC_MASTER_ADDRESS");
  if (!xprv || !destAddress) {
    return new Response(JSON.stringify({ ok: false, error: "LTC_XPRV / LTC_MASTER_ADDRESS not set" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary = { checked: 0, swept: 0, skipped: 0, errors: [] as string[] };

  try {
    // Find paid addresses not yet swept (retry up to 5 times).
    const { data: rows } = await admin
      .from("ltc_reserved_addresses")
      .select("id, address, derivation_index, paid_amount_ltc, sweep_status, sweep_attempts")
      .eq("status", "paid")
      .or("sweep_status.is.null,sweep_status.eq.pending,sweep_status.eq.failed")
      .lt("sweep_attempts", 5)
      .limit(50);

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, ...summary, note: "nothing to sweep" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const feeRate = await fetchFeeRate();

    for (const row of rows) {
      summary.checked++;
      try {
        const utxos = await fetchUtxos(row.address);
        const totalIn = utxos.reduce((s, u) => s + u.value, 0);
        if (utxos.length === 0 || totalIn < DUST_THRESHOLD_SATS) {
          await admin.from("ltc_reserved_addresses")
            .update({ sweep_status: "dust", sweep_error: `insufficient: ${totalIn} sats` })
            .eq("id", row.id);
          summary.skipped++;
          continue;
        }

        const { privKey, pubKey, pkh, address: derived } = deriveLtcPrivateKey(xprv, row.derivation_index);
        if (derived !== row.address) {
          throw new Error(`derived ${derived} != stored ${row.address} (xprv mismatch)`);
        }

        const { txHex, txid, feeSats, sendSats } = buildAndSignSweep(
          utxos, privKey, pubKey, pkh, destAddress, feeRate,
        );

        const broadcastedTxid = await broadcast(txHex);
        const finalTxid = broadcastedTxid || txid;

        await admin.from("ltc_reserved_addresses").update({
          sweep_status: "swept",
          sweep_tx_hash: finalTxid,
          swept_amount_ltc: sendSats / 1e8,
          swept_at: new Date().toISOString(),
          sweep_attempts: (row.sweep_attempts ?? 0) + 1,
          sweep_error: null,
        }).eq("id", row.id);

        summary.swept++;

        const adminChat = Deno.env.get("ADMIN_CHAT_ID");
        if (adminChat) {
          await sendTelegram("sendMessage", {
            chat_id: adminChat,
            text: `🧹 <b>LTC Swept</b>\n\nFrom: <code>${row.address}</code>\nTo: <code>${destAddress}</code>\nAmount: <b>${(sendSats/1e8).toFixed(8)} LTC</b>\nFee: ${feeSats} sats @ ${feeRate} sat/vB\n🔗 <a href="https://litecoinspace.org/tx/${finalTxid}">Tx: ${finalTxid.slice(0,12)}…</a>`,
            parse_mode: "HTML",
          });
        }
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        summary.errors.push(`${row.address}: ${msg}`);
        await admin.from("ltc_reserved_addresses").update({
          sweep_status: "failed",
          sweep_error: msg.slice(0, 500),
          sweep_attempts: (row.sweep_attempts ?? 0) + 1,
        }).eq("id", row.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, feeRate, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ltc-sweep error:", err);
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message ?? err), ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
