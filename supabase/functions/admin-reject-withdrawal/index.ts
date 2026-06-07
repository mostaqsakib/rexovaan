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
    const { withdrawal_id, note } = await req.json();
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

    // Refund balance
    const newBalance = Number(customer.balance) + Number(withdrawal.amount);
    await supabase.from("bot_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", customer.id);

    // Update withdrawal
    await supabase.from("bot_withdrawals").update({
      status: "rejected",
      admin_note: note || null,
      processed_at: new Date().toISOString(),
    }).eq("id", withdrawal_id);

    // Notify user
    await sendTelegramMessage(customer.chat_id,
      `❌ <b>Withdrawal Rejected</b>\n\n` +
      `Your withdrawal request of <b>${Number(withdrawal.amount).toFixed(2)} USDT</b> has been rejected.\n` +
      `The amount has been returned to your balance.\n\n` +
      `💰 Current Balance: <b>${newBalance.toFixed(2)} USDT</b>` +
      (note ? `\n\n📝 <b>Reason:</b> ${note}` : "") +
      `\n\nContact support if you have questions.`,
      mainMenuKeyboard()
    );

    return new Response(JSON.stringify({ success: true, new_balance: newBalance }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Admin reject withdrawal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
