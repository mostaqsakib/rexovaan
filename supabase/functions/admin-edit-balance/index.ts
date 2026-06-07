import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sendTelegramMessage(chatId: number, text: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const TELEGRAM_API_KEY = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"))!;
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": TELEGRAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { customer_id, new_balance, note } = await req.json();

    if (!customer_id || new_balance === undefined || new_balance === null) {
      return new Response(JSON.stringify({ error: "customer_id and new_balance required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!note || !note.trim()) {
      return new Response(JSON.stringify({ error: "Note is required for balance edits" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (Number(new_balance) < 0) {
      return new Response(JSON.stringify({ error: "Balance cannot be negative" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: customer, error: custErr } = await supabase.from("bot_customers").select("*").eq("id", customer_id).single();
    if (custErr || !customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const oldBalance = Number(customer.balance);
    const newBal = Number(new_balance);
    const diff = newBal - oldBalance;

    await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer_id);

    // Log adjustment
    await supabase.from("bot_balance_adjustments").insert({
      customer_id,
      old_balance: oldBalance,
      new_balance: newBal,
      diff,
      note: note.trim(),
      source: "admin",
    });

    // Send Telegram notification
    let emoji = "ℹ️";
    let action = "adjusted";
    if (diff > 0) { emoji = "💰"; action = "credited"; }
    else if (diff < 0) { emoji = "💸"; action = "debited"; }

    const msg =
      `${emoji} <b>Balance ${action.charAt(0).toUpperCase() + action.slice(1)}</b>\n\n` +
      `Previous: <b>${oldBalance.toFixed(2)} USDT</b>\n` +
      `New: <b>${newBal.toFixed(2)} USDT</b>\n` +
      `Change: <b>${diff >= 0 ? '+' : ''}${diff.toFixed(2)} USDT</b>\n\n` +
      `📝 <b>Note:</b> ${note.trim()}`;

    await sendTelegramMessage(customer.chat_id, msg);

    return new Response(JSON.stringify({ success: true, old_balance: oldBalance, new_balance: newBal, diff }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Balance edit error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
