import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.208.0/hash/mod.ts";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function md5(input: string): string {
  const h = createHash("md5");
  h.update(input);
  return h.toString();
}

// Cryptomus IPN signs the body (minus the "sign" field) with md5( base64(json) + api_key ).
// JSON must be re-serialized WITHOUT the sign field, preserving key order Cryptomus used.
function verifySign(rawBody: string, apiKey: string): { ok: boolean; body: any } {
  let parsed: any;
  try { parsed = JSON.parse(rawBody); } catch { return { ok: false, body: null }; }
  const provided = parsed?.sign;
  if (!provided || typeof provided !== "string") return { ok: false, body: parsed };
  const clone = { ...parsed };
  delete clone.sign;
  // Cryptomus expects the JSON to look like PHP json_encode() with slash escaping.
  const jsonForSign = JSON.stringify(clone).replace(/\//g, "\\/");
  const expected = md5(btoa(jsonForSign) + apiKey);
  return { ok: expected === provided, body: parsed };
}

async function sendTelegram(method: string, body: Record<string, unknown>) {
  const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"));
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return;
  await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const API_KEY = Deno.env.get("CRYPTOMUS_PAYMENT_API_KEY");
  if (!API_KEY) return new Response("Not configured", { status: 500 });

  const rawBody = await req.text();
  const { ok, body } = verifySign(rawBody, API_KEY);
  if (!ok) {
    console.warn("[Cryptomus webhook] invalid sign");
    return new Response("Invalid signature", { status: 403 });
  }

  console.log("[Cryptomus webhook] payload:", rawBody);

  const orderId = body?.order_id as string | undefined;
  const status = body?.status as string | undefined;
  const paidAmount = Number(body?.payment_amount_usd ?? body?.merchant_amount ?? body?.amount ?? 0);

  if (!orderId) return new Response("Missing order_id", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: deposit } = await supabase
    .from("bot_deposits")
    .select("*")
    .eq("txn_hash", `cryptomus_${orderId}`)
    .maybeSingle();

  if (!deposit) {
    console.warn("[Cryptomus webhook] deposit not found", orderId);
    return new Response("OK", { status: 200 });
  }

  if (deposit.status === "verified") {
    return new Response("Already verified", { status: 200 });
  }

  // Failed / cancelled states
  if (["fail", "cancel", "system_fail", "wrong_amount_waiting"].includes(String(status))) {
    await supabase
      .from("bot_deposits")
      .update({ status: "rejected" })
      .eq("id", deposit.id)
      .neq("status", "verified");
    return new Response("OK", { status: 200 });
  }

  // Successful states
  const successStates = ["paid", "paid_over"];
  if (!successStates.includes(String(status))) {
    // confirming/check/etc — ignore, wait for next callback
    return new Response("OK", { status: 200 });
  }

  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    console.error("[Cryptomus webhook] invalid paid amount", paidAmount);
    return new Response("Invalid amount", { status: 400 });
  }

  const { data: customer } = await supabase
    .from("bot_customers")
    .select("chat_id, balance")
    .eq("id", deposit.customer_id)
    .maybeSingle();

  const hasPendingProduct = deposit.pending_product_id && deposit.pending_quantity;

  if (hasPendingProduct) {
    const { data: updated } = await supabase
      .from("bot_deposits")
      .update({ status: "pending", amount: paidAmount })
      .eq("id", deposit.id)
      .neq("status", "verified")
      .select("id")
      .maybeSingle();
    if (!updated) return new Response("Already processed", { status: 200 });
  } else {
    const { data: updated } = await supabase
      .from("bot_deposits")
      .update({
        status: "verified",
        amount: paidAmount,
        verified_at: new Date().toISOString(),
      })
      .eq("id", deposit.id)
      .neq("status", "verified")
      .select("id")
      .maybeSingle();
    if (!updated) return new Response("Already processed", { status: 200 });

    const applied = await applyDepositCredit(supabase, deposit.customer_id, paidAmount);
    await supabase.from("bot_customers")
      .update({ pending_action: null, updated_at: new Date().toISOString() })
      .eq("id", deposit.customer_id);

    const chatId = customer?.chat_id;
    if (chatId) {
      const plLine = applied.paidPayLater > 0
        ? `\n🏷️ Pay-Later Cleared: <b>$${applied.paidPayLater.toFixed(2)} USDT</b>` : "";
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: `✅ <b>Crypto Payment Verified!</b>\n\n💵 Credited: <b>$${paidAmount.toFixed(2)} USDT</b>${plLine}\n💳 New Balance: <b>$${applied.newBalance.toFixed(2)} USDT</b>\n🧾 Order: <code>${orderId}</code>`,
        parse_mode: "HTML",
      });
    }

    const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
    if (adminChatId) {
      await sendTelegram("sendMessage", {
        chat_id: adminChatId,
        text: `💰 <b>Cryptomus Payment Received</b>\n\nCustomer: ${customer?.chat_id || deposit.customer_id}\nAmount: $${paidAmount.toFixed(2)} USDT\nOrder: <code>${orderId}</code>`,
        parse_mode: "HTML",
      });
    }
  }

  return new Response("OK", { status: 200 });
});
