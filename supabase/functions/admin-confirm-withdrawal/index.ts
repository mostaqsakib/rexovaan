import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyCustomer } from "../_shared/notify-customer.ts";
import { requireAdmin } from "../_shared/require-admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  const _adminGuard = await requireAdmin(req, corsHeaders);
  if (_adminGuard) return _adminGuard;

  try {
    const { withdrawal_id, proof_url, admin_note } = await req.json();
    if (!withdrawal_id) {
      return new Response(JSON.stringify({ error: "withdrawal_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Atomic conditional update — only the first caller wins.
    const { data: withdrawal, error: wErr } = await supabase
      .from("bot_withdrawals")
      .update({
        status: "completed",
        proof_url: proof_url || null,
        admin_note: admin_note || null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", withdrawal_id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (wErr) {
      return new Response(JSON.stringify({ error: wErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!withdrawal) {
      return new Response(JSON.stringify({ error: "Withdrawal not found or already processed" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: customer } = await supabase.from("bot_customers").select("*").eq("id", withdrawal.customer_id).single();
    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const caption = `✅ <b>Withdrawal Completed!</b>\n\n` +
      `Amount: <b>${Number(withdrawal.amount).toFixed(2)} USDT</b>\n` +
      `Payment Details: <b>${withdrawal.payment_details}</b>` +
      (admin_note ? `\n\n📝 <b>Note:</b> ${admin_note}` : "");

    await notifyCustomer(supabase, {
      customer,
      telegram: proof_url
        ? { text: caption, photoUrl: proof_url }
        : { text: caption, replyMarkup: mainMenuKeyboard() },
      email: {
        templateName: "withdrawal-completed",
        templateData: {
          customerName: customer.first_name,
          amount: withdrawal.amount,
          paymentDetails: withdrawal.payment_details,
          proofUrl: proof_url || undefined,
          adminNote: admin_note || undefined,
        },
      },
    });

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Admin confirm withdrawal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
