import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
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

  if (!deposit || !paymentID) {
    return new Response(generateHTML("❌ Payment not found or already processed."), {
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  if (deposit.status === "verified") {
    return new Response(generateHTML("✅ Payment already processed. You can close this window."), {
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  const { data: customer } = await supabase
    .from("bot_customers")
    .select("chat_id, balance")
    .eq("id", deposit.customer_id)
    .maybeSingle();

  if (status !== "success") {
    // Payment cancelled or failed — keep a retryable status so a later success callback can still be processed.
    await supabase
      .from("bot_deposits")
      .update({ status: status === "cancel" ? "bkash_cancelled" : "rejected" })
      .eq("id", deposit.id)
      .neq("status", "verified");
    
    // Notify user via Telegram
    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: "❌ <b>bKash Payment Cancelled</b>\n\nYour payment was not completed. You can try again from the menu.",
        parse_mode: "HTML",
      });
    }

    return new Response(generateHTML("❌ Payment was cancelled. You can close this window."), {
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  // Execute the payment
  const token = await getBkashToken();
  if (!token) {
    return new Response(generateHTML("❌ Server error. Please contact support."), {
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
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
    await supabase.from("bot_deposits").update({ status: "rejected" }).eq("id", deposit.id);
    
    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: `❌ <b>bKash Payment Failed</b>\n\n${execData.statusMessage || "Payment could not be completed."}`,
        parse_mode: "HTML",
      });
    }

    return new Response(generateHTML("❌ Payment failed. Please try again."), {
      headers: { ...corsHeaders, "Content-Type": "text/html" },
    });
  }

  // Payment successful!
  const bdtAmount = parseFloat(execData.amount);
  const trxID = execData.trxID;

  // Get dollar rate
  const { data: rateSetting } = await supabase
    .from("bot_settings")
    .select("value")
    .eq("key", "dollar_rate_bdt")
    .maybeSingle();
  const rate = rateSetting ? parseFloat(rateSetting.value) : 125;
  const usdtAmount = parseFloat((bdtAmount / rate).toFixed(2));

  const hasPendingProduct = deposit.pending_product_id && deposit.pending_quantity;

  if (hasPendingProduct) {
    // Has pending product — set to "pending" with real trxID so the bot's
    // background checker picks it up and handles delivery automatically
    const { data: updatedDeposit } = await supabase
      .from("bot_deposits")
      .update({
        status: "pending",
        txn_hash: trxID,
        amount: usdtAmount,
      })
      .eq("id", deposit.id)
      .neq("status", "verified")
      .select("id")
      .maybeSingle();

    if (!updatedDeposit) {
      return new Response(generateHTML("✅ Payment already processed."), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: `✅ <b>bKash Payment Received!</b>\n\n💰 Paid: <b>৳${bdtAmount.toFixed(2)} BDT</b>\n🧾 TrxID: <code>${trxID}</code>\n\n⏳ Processing your order...`,
        parse_mode: "HTML",
      });
    }
  } else {
    // Regular deposit — credit balance directly
    const { data: updatedDeposit } = await supabase
      .from("bot_deposits")
      .update({
        status: "verified",
        txn_hash: trxID,
        amount: usdtAmount,
        verified_at: new Date().toISOString(),
      })
      .eq("id", deposit.id)
      .neq("status", "verified")
      .select("id")
      .maybeSingle();

    if (!updatedDeposit) {
      return new Response(generateHTML("✅ Payment already processed."), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    const currentBalance = Number(customer?.balance || 0);
    const newBalance = currentBalance + usdtAmount;
    await supabase.from("bot_customers").update({
      balance: newBalance,
      pending_action: null,
      updated_at: new Date().toISOString(),
    }).eq("id", deposit.customer_id);

    const chatId = customer?.chat_id;
    if (chatId) {
      await sendTelegram("sendMessage", {
        chat_id: chatId,
        text: `✅ <b>bKash Payment Verified!</b>\n\n💰 Paid: <b>৳${bdtAmount.toFixed(2)} BDT</b>\n📊 Rate: 1 USD = ${rate} BDT\n💵 Credited: <b>$${usdtAmount.toFixed(2)} USDT</b>\n💳 New Balance: <b>$${newBalance.toFixed(2)} USDT</b>\n🧾 TrxID: <code>${trxID}</code>`,
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

  return new Response(generateHTML("✅ Payment successful! You can close this window and return to Telegram."), {
    headers: { ...corsHeaders, "Content-Type": "text/html" },
  });
});

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

function generateHTML(_message: string): string {
  const botUsername = Deno.env.get("BOT_USERNAME") || "";
  const tgLink = botUsername ? `https://t.me/${botUsername}` : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>bKash Payment</title>
  <style>body{margin:0;background:#f5f5f5;}</style>
</head>
<body>
  <script>
    (function() {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.close();
      }
      try { window.close(); } catch(e) {}
      var tgLink = "${tgLink}";
      if (tgLink) { window.location.href = tgLink; }
    })();
  </script>
</body>
</html>`;
}
