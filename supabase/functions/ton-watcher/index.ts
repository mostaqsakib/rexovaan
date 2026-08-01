import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// USDT Jetton master on TON
const USDT_JETTON = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const USDT_JETTON_RAW = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";
const USDT_DECIMALS = 6;

function isUsdtJetton(jetton: { address?: string; symbol?: string; name?: string; decimals?: number } | undefined) {
  if (!jetton) return false;
  const address = String(jetton.address || "").toLowerCase();
  if (address === USDT_JETTON.toLowerCase() || address === USDT_JETTON_RAW.toLowerCase()) return true;

  const normalizedSymbol = String(jetton.symbol || "")
    .toUpperCase()
    .replace(/₮/g, "T")
    .replace(/[^A-Z0-9]/g, "");

  return normalizedSymbol === "USDT" && Number(jetton.decimals ?? USDT_DECIMALS) === USDT_DECIMALS;
}

const TON_DECIMALS = 9;

async function getTonUsdRate(): Promise<number | null> {
  try {
    const res = await fetch("https://tonapi.io/v2/rates?tokens=ton&currencies=usd", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rate = Number(json?.rates?.TON?.prices?.USD);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch (_) {
    return null;
  }
}

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

async function getTonAddress(): Promise<string | null> {
  const { data } = await supabase
    .from("bot_settings")
    .select("value")
    .eq("key", "usdt_ton_address")
    .maybeSingle();

  return (data?.value || Deno.env.get("USDT_TON_ADDRESS") || "").trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const tonAddress = await getTonAddress();
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

    // Load pending + recently expired reservations (for late-payment detection)
    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pendings, error: pErr } = await supabase
      .from("ton_reserved_deposits")
      .select("id, customer_id, deposit_id, memo, expected_amount, status")
      .in("status", ["pending", "expired", "rejected"])
      .gte("created_at", cutoffIso);
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
    let tonUsdRate: number | null = null;
    for (const ev of events.events || []) {
      for (const act of ev.actions || []) {
        const isJetton = act.type === "JettonTransfer";
        const isNativeTon = act.type === "TonTransfer";
        if (!isJetton && !isNativeTon) continue;
        const jt = isJetton ? act.JettonTransfer : act.TonTransfer;
        if (!jt) continue;
        if (isJetton && !isUsdtJetton(jt.jetton)) continue;
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
        let receivedUsd = 0;
        let assetLabel = "USDT";
        if (isNativeTon) {
          const tonAmount = Number(rawAmount) / Math.pow(10, TON_DECIMALS);
          if (tonAmount <= 0) continue;
          if (tonUsdRate === null) tonUsdRate = await getTonUsdRate();
          if (!tonUsdRate) {
            console.error("[ton-watcher] TON/USD rate unavailable, skipping native transfer", txHash);
            continue;
          }
          receivedUsd = Math.round(tonAmount * tonUsdRate * 100) / 100;
          assetLabel = `${tonAmount.toFixed(4)} TON`;
        } else {
          receivedUsd = Number(rawAmount) / Math.pow(10, USDT_DECIMALS);
          assetLabel = `${receivedUsd.toFixed(2)} USDT`;
        }
        if (receivedUsd <= 0) continue;

        const isLate = reservation.status === "expired" || reservation.status === "rejected";

        await supabase.from("ton_reserved_deposits").update({
          status: isLate ? "late_paid" : "paid",
          received_amount: receivedUsd,
          tx_hash: txHash,
          from_address: jt.sender?.address || null,
          paid_at: new Date().toISOString(),
        }).eq("id", reservation.id);

        if (reservation.deposit_id) {
          await supabase.from("bot_deposits").update({
            status: isLate ? "late_pending" : "verified",
            amount: receivedUsd,
            txn_hash: txHash,
            ...(isLate ? {} : { verified_at: new Date().toISOString() }),
          }).eq("id", reservation.deposit_id);
        }

        const { data: cust } = await supabase
          .from("bot_customers")
          .select("id, chat_id, balance")
          .eq("id", reservation.customer_id)
          .maybeSingle();

        if (isLate) {
          if (cust?.chat_id) {
            await notifyCustomer(String(cust.chat_id), `⏰ <b>Late TON Payment Detected</b>\n\n💵 Amount: <b>${assetLabel}</b> (≈ $${receivedUsd.toFixed(2)})\n🆔 Memo: <code>${memo}</code>\n\nYour payment arrived after the checkout window expired. Our team will credit your account shortly.`);
          }
          const adminChat = Deno.env.get("ADMIN_CHAT_ID");
          if (adminChat) {
            await notifyCustomer(adminChat, `⏰ <b>LATE TON PAYMENT</b>\n⚠️ Needs manual credit.\n\nAmount: <b>${assetLabel}</b> (≈ $${receivedUsd.toFixed(2)})\nMemo: <code>${memo}</code>\nDeposit: <code>${reservation.deposit_id}</code>`);
          }
        } else if (cust) {
          const newBalance = Number(cust.balance || 0) + receivedUsd;
          await supabase.from("bot_customers").update({ balance: newBalance }).eq("id", cust.id);
          await notifyCustomer(String(cust.chat_id), `✅ <b>TON deposit confirmed</b>\n\n💰 Received: <b>${assetLabel}</b> (≈ $${receivedUsd.toFixed(2)})\n🆔 Memo: <code>${memo}</code>\n💵 New balance: <b>$${newBalance.toFixed(2)}</b>`);
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
