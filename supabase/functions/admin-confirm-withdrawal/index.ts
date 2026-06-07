import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: unknown) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"))!;
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendTelegramPhoto(chatId: number, photoUrl: string, caption?: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"))!;
  const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, parse_mode: "HTML" };
  if (caption) body.caption = caption;
  await fetch(`${GATEWAY_URL}/sendPhoto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mainMenuKeyboard = () => ({
  inline_keyboard: [
    [{ text: "🛒 Shop", callback_data: "menu_shop" }],
    [{ text: "💳 Deposit", callback_data: "menu_deposit" }, { text: "💰 Balance", callback_data: "menu_balance" }],
    [{ text: "🧾 My Orders", callback_data: "menu_orders" }, { text: "💸 Withdraw", callback_data: "menu_withdraw" }],
    [{ text: "🆘 Support", callback_data: "menu_support" }],
  ],
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { withdrawal_id, proof_url, admin_note } = await req.json();
    if (!withdrawal_id) {
      return new Response(JSON.stringify({ error: "withdrawal_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: withdrawal, error: wErr } = await supabase.from("bot_withdrawals").select("*").eq("id", withdrawal_id).single();
    if (wErr || !withdrawal) {
      return new Response(JSON.stringify({ error: "Withdrawal not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (withdrawal.status !== "pending") {
      return new Response(JSON.stringify({ error: "Already processed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: customer } = await supabase.from("bot_customers").select("*").eq("id", withdrawal.customer_id).single();
    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Update withdrawal status
    await supabase.from("bot_withdrawals").update({
      status: "completed",
      proof_url: proof_url || null,
      admin_note: admin_note || null,
      processed_at: new Date().toISOString(),
    }).eq("id", withdrawal_id);

    // Send confirmation to user
    const caption = `✅ <b>Withdrawal Completed!</b>\n\n` +
      `Amount: <b>${Number(withdrawal.amount).toFixed(2)} USDT</b>\n` +
      `Payment Details: <b>${withdrawal.payment_details}</b>` +
      (admin_note ? `\n\n📝 <b>Note:</b> ${admin_note}` : "");

    if (proof_url) {
      await sendTelegramPhoto(customer.chat_id, proof_url, caption);
    } else {
      await sendTelegramMessage(customer.chat_id, caption, mainMenuKeyboard());
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Admin confirm withdrawal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
