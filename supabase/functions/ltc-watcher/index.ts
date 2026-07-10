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

interface Vout { scriptpubkey_address?: string; value: number }
interface Tx { txid: string; vout: Vout[]; status: { confirmed: boolean; block_height?: number; block_time?: number } }

async function fetchAddressTxs(addr: string): Promise<Tx[]> {
  const r = await fetch(`${EXPLORER}/address/${addr}/txs`);
  if (!r.ok) throw new Error(`explorer ${r.status}`);
  return await r.json();
}
async function fetchTipHeight(): Promise<number> {
  const r = await fetch(`${EXPLORER}/blocks/tip/height`);
  return Number(await r.text());
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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary = { checked: 0, credited: 0, skipped: 0, errors: [] as string[] };

  try {
    // Expire old
    await admin.from("ltc_reserved_addresses").update({ status: "expired" })
      .eq("status", "pending").lt("expires_at", new Date().toISOString());

    const { data: settings } = await admin.from("ltc_settings").select("*").eq("singleton", true).single();
    const minConf = Number(settings?.min_confirmations ?? 2);

    const { data: reserved } = await admin
      .from("ltc_reserved_addresses").select("*").eq("status", "pending").limit(200);

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

          for (let voutIdx = 0; voutIdx < tx.vout.length; voutIdx++) {
            const v = tx.vout[voutIdx];
            if (v.scriptpubkey_address !== row.address) continue;
            const amountLtc = v.value / 1e8;

            // Idempotency
            const { data: existing } = await admin.from("ltc_payment_registry")
              .select("id").eq("tx_hash", tx.txid).eq("vout", voutIdx).maybeSingle();
            if (existing) { summary.skipped++; continue; }

            const expected = Number(row.expected_amount_ltc);
            const minAcceptable = expected * (1 - AMOUNT_TOLERANCE);
            if (amountLtc < minAcceptable) {
              await admin.from("ltc_payment_registry").insert({
                tx_hash: tx.txid, vout: voutIdx, address: row.address, amount_ltc: amountLtc,
                block_height: tx.status.block_height, confirmations: conf, reserved_address_id: row.id,
              });
              summary.skipped++;
              continue;
            }

            const usdCredited = Number((amountLtc * Number(row.ltc_usd_rate)).toFixed(4));
            let customerChatId: number | null = null;
            let creditResult: { newBalance: number; paidPayLater: number } | null = null;

            if (row.deposit_id) {
              const { data: dep } = await admin.from("bot_deposits")
                .select("customer_id").eq("id", row.deposit_id).maybeSingle();
              if (dep?.customer_id) {
                try {
                  creditResult = await applyDepositCredit(admin, dep.customer_id, usdCredited);
                } catch (e) { console.error("credit err", e); }

                await admin.from("bot_deposits").update({
                  status: "verified", verified_at: new Date().toISOString(),
                  ltc_address: row.address, ltc_tx_hash: tx.txid, txn_hash: tx.txid,
                }).eq("id", row.deposit_id);

                const { data: cust } = await admin.from("bot_customers")
                  .select("chat_id").eq("id", dep.customer_id).maybeSingle();
                customerChatId = cust?.chat_id ?? null;
              }
            }

            await admin.from("ltc_payment_registry").insert({
              tx_hash: tx.txid, vout: voutIdx, address: row.address, amount_ltc: amountLtc,
              block_height: tx.status.block_height, confirmations: conf,
              reserved_address_id: row.id, deposit_id: row.deposit_id,
            });

            await admin.from("ltc_reserved_addresses").update({
              status: "paid", paid_tx_hash: tx.txid, paid_amount_ltc: amountLtc,
              paid_at: new Date().toISOString(),
            }).eq("id", row.id);

            summary.credited++;

            if (customerChatId) {
              const shortTx = `${tx.txid.slice(0, 10)}…${tx.txid.slice(-8)}`;
              const plLine = creditResult && creditResult.paidPayLater > 0
                ? `\n🏷️ Pay-Later Cleared: <b>$${creditResult.paidPayLater.toFixed(2)}</b>` : "";
              const balLine = creditResult
                ? `\n💳 New Balance: <b>$${creditResult.newBalance.toFixed(2)}</b>` : "";
              await sendTelegram("sendMessage", {
                chat_id: customerChatId,
                text: `✅ <b>LTC Deposit Verified!</b>\n\n💵 Received: <b>${amountLtc.toFixed(8)} LTC</b>\n💰 Credited: <b>$${usdCredited.toFixed(2)}</b>${plLine}${balLine}\n🔗 <a href="https://litecoinspace.org/tx/${tx.txid}">Tx: ${shortTx}</a>`,
                parse_mode: "HTML",
              });
            }
            const adminChat = Deno.env.get("ADMIN_CHAT_ID");
            if (adminChat) {
              await sendTelegram("sendMessage", {
                chat_id: adminChat,
                text: `💰 <b>LTC Deposit</b>\n\nAmount: <b>${amountLtc.toFixed(8)} LTC</b> ($${usdCredited.toFixed(2)})\nAddress: <code>${row.address}</code>\n<a href="https://litecoinspace.org/tx/${tx.txid}">Tx</a>`,
                parse_mode: "HTML",
              });
            }
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
