import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BKASH_BASE = "https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout";

async function getBkashToken(): Promise<string | null> {
  const appKey = Deno.env.get("BKASH_APP_KEY");
  const appSecret = Deno.env.get("BKASH_APP_SECRET");
  const username = Deno.env.get("BKASH_USERNAME");
  const password = Deno.env.get("BKASH_PASSWORD");
  if (!appKey || !appSecret || !username || !password) return null;

  const res = await fetch(`${BKASH_BASE}/token/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", username, password },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id_token || null;
}

const SITE_URL = (Deno.env.get("SITE_URL") || "https://rexovaan.com").replace(/\/$/, "");

function resultRedirect(source: string | null, status: "success" | "cancel" | "failed", message: string, extra: Record<string, string> = {}) {
  const botUsername = Deno.env.get("BOT_USERNAME") || "";
  const params = new URLSearchParams({
    status,
    msg: message,
    source: source === "web" ? "web" : "bot",
    ...(botUsername ? { bot: botUsername } : {}),
    ...extra,
  });
  return `${SITE_URL}/payment-result?${params.toString()}`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // SECURITY: verify callback secret to prevent unauthorized invocation
  const BKASH_CALLBACK_SECRET = Deno.env.get("BKASH_CALLBACK_SECRET");
  if (BKASH_CALLBACK_SECRET) {
    const providedSecret = url.searchParams.get("callback_secret");
    if (!providedSecret || providedSecret !== BKASH_CALLBACK_SECRET) {
      console.warn("[bKash] Invalid or missing callback_secret");
      return new Response("Forbidden", { status: 403 });
    }
  }

  const paymentID = url.searchParams.get("paymentID");
  const status = url.searchParams.get("status");

  console.log(`[bKash Callback] paymentID=${paymentID}, status=${status}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Find the deposit with this paymentID
  const { data: deposit } = await supabase
    .from("bot_deposits")
    .select("*")
    .eq("txn_hash", `bkash_${paymentID}`)
    .maybeSingle();

  const source = deposit?.source ?? "web";
  const htmlResp = (status: "success" | "cancel" | "failed", message: string, extra: Record<string, string> = {}) =>
    new Response(redirectHTML(source, status, message, extra), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });

  if (!deposit || !paymentID) {
    return htmlResp("failed", "Payment not found or already processed.");
  }

  // Clear the "Continue to Pay" prompt in Telegram (issue: leftover order/payment buttons)
  if (deposit.prompt_message_id && deposit.prompt_chat_id) {
    await sendTelegram("deleteMessage", {
      chat_id: deposit.prompt_chat_id,
      message_id: deposit.prompt_message_id,
    }).catch(() => {});
    await supabase.from("bot_deposits")
      .update({ prompt_message_id: null, prompt_chat_id: null })
      .eq("id", deposit.id);
  }

  if (deposit.status === "verified") {
    return htmlResp("success", "Payment already processed.");
  }

  const { data: customer } = await supabase
    .from("bot_customers")
    .select("chat_id, balance")
    .eq("id", deposit.customer_id)
    .maybeSingle();

  if (status !== "success") {
    // Payment cancelled or failed
    await supabase
      .from("bot_deposits")
      .update({
        status: status === "cancel" ? "bkash_cancelled" : "rejected",
        payment_method: "bKash",
        via: "bKash",
      })
      .eq("id", deposit.id)
      .neq("status", "verified");

    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: "❌ <b>bKash Payment Cancelled</b>\n\nYour payment was not completed. You can try again from the menu.",
        parse_mode: "HTML",
      });
    }

    if (status === "cancel") return htmlResp("cancel", "You cancelled the payment. You can try again.");
    return htmlResp("failed", "Payment failed. Please try again.");
  }

  // Execute the payment
  const token = await getBkashToken();
  if (!token) {
    return htmlResp("failed", "Server error. Please contact support.");
  }

  const appKey = Deno.env.get("BKASH_APP_KEY")!;
  const execRes = await fetch(`${BKASH_BASE}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      authorization: token,
      "x-app-key": appKey,
    },
    body: JSON.stringify({ paymentID }),
  });

  const execData = await execRes.json();
  console.log(`[bKash Execute] Response:`, JSON.stringify(execData));

  if (execData.statusCode !== "0000" && execData.transactionStatus !== "Completed") {
    await supabase.from("bot_deposits").update({
      status: "rejected",
      payment_method: "bKash",
      via: "bKash",
    }).eq("id", deposit.id);

    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: `❌ <b>bKash Payment Failed</b>\n\n${execData.statusMessage || "Payment could not be completed."}`,
        parse_mode: "HTML",
      });
    }

    return htmlResp("failed", execData.statusMessage || "Payment could not be completed.");
  }

  // Payment successful!
  const bdtAmount = parseFloat(execData.amount);
  const trxID = execData.trxID;

  // Sanity: bKash must return a positive amount and a trxID. Refuse otherwise.
  if (!Number.isFinite(bdtAmount) || bdtAmount <= 0 || !trxID) {
    console.error("[bKash] invalid execute response", { bdtAmount, trxID });
    await supabase.from("bot_deposits").update({ status: "rejected" }).eq("id", deposit.id).neq("status", "verified");
    return htmlResp("failed", "Invalid payment response from bKash.");
  }

  // Get dollar rate — clamp to safe band so a misconfigured/poisoned setting
  // cannot over-credit the customer.
  const { data: rateSetting } = await supabase
    .from("bot_settings")
    .select("value")
    .eq("key", "dollar_rate_bdt")
    .maybeSingle();
  const rawRate = rateSetting ? parseFloat(rateSetting.value) : 125;
  const RATE_MIN = 80;   // BDT per 1 USDT — well below realistic floor
  const RATE_MAX = 200;  // and well above realistic ceiling
  if (!Number.isFinite(rawRate) || rawRate < RATE_MIN || rawRate > RATE_MAX) {
    console.error("[bKash] dollar_rate_bdt out of safe band", { rawRate });
    await supabase.from("bot_deposits").update({ status: "rejected" }).eq("id", deposit.id).neq("status", "verified");
    return htmlResp("failed", "Server rate misconfigured. Contact support.");
  }
  const rate = rawRate;
  const usdtAmount = parseFloat((bdtAmount / rate).toFixed(2));
  if (!Number.isFinite(usdtAmount) || usdtAmount <= 0) {
    await supabase.from("bot_deposits").update({ status: "rejected" }).eq("id", deposit.id).neq("status", "verified");
    return htmlResp("failed", "Computed amount invalid.");
  }

  const hasPendingProduct = deposit.pending_product_id && deposit.pending_quantity;

  if (hasPendingProduct) {
    // Mark payment received (still "pending" so admin-verify can flip to verified & deliver)
    const { data: updatedDeposit } = await supabase
      .from("bot_deposits")
      .update({
        status: "pending",
        txn_hash: trxID,
        amount: usdtAmount,
        payment_method: "bKash",
        via: `bKash Auto · ৳${bdtAmount.toFixed(2)} @ ${rate}`,
      })
      .eq("id", deposit.id)
      .neq("status", "verified")
      .select("id")
      .maybeSingle();

    if (!updatedDeposit) {
      return htmlResp("success", "Payment already processed.");
    }

    // Auto-fulfill via admin-verify-deposit (uses service_role bypass in require-admin)
    let fulfillErr: string | null = null;
    try {
      const fnRes = await fetch(`${supabaseUrl}/functions/v1/admin-verify-deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
        body: JSON.stringify({ deposit_id: deposit.id, amount: usdtAmount }),
      });
      const fnData = await fnRes.json().catch(() => ({}));
      if (!fnRes.ok) {
        fulfillErr = fnData?.error || `HTTP ${fnRes.status}`;
        console.error("[bKash] auto-fulfill failed", fulfillErr, fnData);
      }
    } catch (e) {
      fulfillErr = String((e as Error).message || e);
      console.error("[bKash] auto-fulfill threw", fulfillErr);
    }

    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: fulfillErr
          ? `✅ <b>bKash Payment Received!</b>\n\n💰 Paid: <b>৳${bdtAmount.toFixed(2)} BDT</b>\n🧾 TrxID: <code>${trxID}</code>\n\n⏳ Order is being processed by admin.`
          : `✅ <b>bKash Payment Received!</b>\n\n💰 Paid: <b>৳${bdtAmount.toFixed(2)} BDT</b>\n🧾 TrxID: <code>${trxID}</code>\n\n📦 Your order has been delivered — check your messages.`,
        parse_mode: "HTML",
      });
    }

    const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
    if (adminChatId && fulfillErr) {
      await sendTelegram("sendMessage", {
        chat_id: adminChatId,
        text: `⚠️ <b>bKash order auto-fulfill failed</b>\n\nDeposit: <code>${deposit.id}</code>\nTrxID: <code>${trxID}</code>\nAmount: $${usdtAmount.toFixed(2)}\nError: ${fulfillErr}\n\nPlease verify manually.`,
        parse_mode: "HTML",
      });
    }
  } else {
    const { data: updatedDeposit } = await supabase
      .from("bot_deposits")
      .update({
        status: "verified",
        txn_hash: trxID,
        amount: usdtAmount,
        verified_at: new Date().toISOString(),
        payment_method: "bKash",
        via: `bKash Auto · ৳${bdtAmount.toFixed(2)} @ ${rate}`,
      })
      .eq("id", deposit.id)
      .neq("status", "verified")
      .select("id")
      .maybeSingle();

    if (!updatedDeposit) {
      return htmlResp("success", "Payment already processed.");
    }

    // Apply deposit: clear pay-later due first, then credit balance
    const applied = await applyDepositCredit(supabase, deposit.customer_id, usdtAmount);
    const newBalance = applied.newBalance;

    await supabase.from("bot_customers")
      .update({ pending_action: null, updated_at: new Date().toISOString() })
      .eq("id", deposit.customer_id);

    const chatId = customer?.chat_id;
    if (chatId) {
      const plLine = applied.paidPayLater > 0
        ? `\n🏷️ Pay-Later Cleared: <b>$${applied.paidPayLater.toFixed(2)} USDT</b>`
        : "";
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: `✅ <b>bKash Payment Verified!</b>\n\n💰 Paid: <b>৳${bdtAmount.toFixed(2)} BDT</b>\n📊 Rate: 1 USD = ${rate} BDT\n💵 Credited: <b>$${usdtAmount.toFixed(2)} USDT</b>${plLine}\n💳 New Balance: <b>$${newBalance.toFixed(2)} USDT</b>\n🧾 TrxID: <code>${trxID}</code>`,
        parse_mode: "HTML",
      });
    }

    const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
    if (adminChatId) {
      const chatId = customer?.chat_id;
      await sendTelegram("sendMessage", {
        chat_id: adminChatId,
        text: `💰 <b>bKash Payment Received</b>\n\nFrom: ${chatId}\nAmount: ৳${bdtAmount.toFixed(2)} BDT ($${usdtAmount.toFixed(2)} USDT)\nTrxID: <code>${trxID}</code>`,
        parse_mode: "HTML",
      });
    }
  }

  return htmlResp("success", `Paid ৳${bdtAmount.toFixed(2)} BDT — $${usdtAmount.toFixed(2)} added to your balance.`, {
    amount: String(usdtAmount),
    trx: trxID,
  });
});

async function sendTelegram(method: string, body: Record<string, unknown>) {
  const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
  const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"));
  if (!BOT_TOKEN && (!LOVABLE_API_KEY || !TELEGRAM_API_KEY)) return;

  const res = await fetch(BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}/${method}` : `${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: BOT_TOKEN
      ? { "Content-Type": "application/json" }
      : {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": TELEGRAM_API_KEY!,
          "Content-Type": "application/json",
        },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[bKash] Telegram ${method} failed`, res.status, await res.text().catch(() => ""));
  }
}

