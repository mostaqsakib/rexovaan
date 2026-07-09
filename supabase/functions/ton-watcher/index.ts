import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// USDT Jetton master on TON
const USDT_JETTON = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const USDT_DECIMALS = 6;

async function notifyCustomer(chatId: string, text: string) {
  const token = Deno.env.get("BOT_TOKEN");
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (_) {}
}

async function fetchTonEvents(address: string) {
  // tonapi.io free tier — decoded jetton transfer events with comments
  const url = `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/events?limit=50`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`tonapi ${res.status}: ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const tonAddress = Deno.env.get("USDT_TON_ADDRESS");
    if (!tonAddress) {
      return new Response(JSON.stringify({ error: "USDT_TON_ADDRESS not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Expire old pending reservations
    await supabase
      .from("ton_reserved_deposits")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    // Load pending reservations
    const { data: pendings, error: pErr } = await supabase
      .from("ton_reserved_deposits")
      .select("id, customer_id, deposit_id, memo, expected_amount")
      .eq("status", "pending");
    if (pErr) throw pErr;
    if (!pendings || pendings.length === 0) {
      return new Response(JSON.stringify({ scanned: 0, matched: 0, message: "no pending reservations" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const memoMap = new Map<string, typeof pendings[number]>();
    for (const p of pendings) memoMap.set(String(p.memo).trim(), p);

    const events = await fetchTonEvents(tonAddress);
    let matched = 0;
    for (const ev of events.events || []) {
      for (const act of ev.actions || []) {
        if (act.type !== "JettonTransfer") continue;
        const jt = act.JettonTransfer;
        if (!jt) continue;
        if (jt.jetton?.address && jt.jetton.address.toLowerCase() !== USDT_JETTON.toLowerCase()) {
          // Only USDT jetton
          const sym = (jt.jetton?.symbol || "").toUpperCase();
          if (sym !== "USDT") continue;
        }
        // recipient must be our wallet
        const dest = jt.recipient?.address || jt.destination?.address;
        if (!dest) continue;
        const comment = (jt.comment || "").trim();
        if (!comment) continue;
        // Extract 6-digit memo from comment
        const m = comment.match(/\d{6}/);
        if (!m) continue;
        const memo = m[0];
        const reservation = memoMap.get(memo);
        if (!reservation) continue;

        const txHash: string = ev.event_id || jt.transaction_id || "";
        // Idempotency: skip if this txHash already applied
        const { data: existing } = await supabase
          .from("ton_reserved_deposits")
          .select("id")
          .eq("tx_hash", txHash)
          .maybeSingle();
        if (existing) continue;

        const rawAmount = BigInt(jt.amount || "0");
        const receivedUsd = Number(rawAmount) / Math.pow(10, USDT_DECIMALS);
        if (receivedUsd <= 0) continue;

        // Credit
        await supabase.from("ton_reserved_deposits").update({
          status: "paid",
          received_amount: receivedUsd,
          tx_hash: txHash,
          from_address: jt.sender?.address || null,
          paid_at: new Date().toISOString(),
        }).eq("id", reservation.id);

        if (reservation.deposit_id) {
          await supabase.from("bot_deposits").update({
            status: "confirmed",
            amount: receivedUsd,
            txn_hash: txHash,
          }).eq("id", reservation.deposit_id);
        }

        // Credit customer balance
        const { data: cust } = await supabase
          .from("bot_customers")
          .select("id, chat_id, balance")
          .eq("id", reservation.customer_id)
          .maybeSingle();
        if (cust) {
          const newBalance = Number(cust.balance || 0) + receivedUsd;
          await supabase.from("bot_customers").update({ balance: newBalance }).eq("id", cust.id);
          await notifyCustomer(String(cust.chat_id), `✅ <b>USDT TON deposit confirmed</b>\n\n💰 Received: <b>${receivedUsd.toFixed(2)} USDT</b>\n🆔 Memo: <code>${memo}</code>\n💵 New balance: <b>$${newBalance.toFixed(2)}</b>`);
        }
        matched++;
      }
    }
    return new Response(JSON.stringify({ scanned: pendings.length, matched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
