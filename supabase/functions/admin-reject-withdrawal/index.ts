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
    const { withdrawal_id, note } = await req.json();
    if (!withdrawal_id) {
      return new Response(JSON.stringify({ error: "withdrawal_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Atomic conditional update — only first caller wins.
    const { data: withdrawal, error: wErr } = await supabase
      .from("bot_withdrawals")
      .update({
        status: "rejected",
        admin_note: note || null,
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

    // Refund balance atomically via SECURITY DEFINER RPC.
    const { data: refundRows, error: refundErr } = await supabase.rpc("refund_customer_balance", {
      _customer_id: customer.id,
      _amount: Number(withdrawal.amount),
    });
    if (refundErr) {
      console.error("refund_customer_balance failed", refundErr);
    }
    const newBalance = Array.isArray(refundRows)
      ? Number(refundRows[0]?.new_balance ?? customer.balance)
      : Number((refundRows as any)?.new_balance ?? customer.balance);

    const tgText = `❌ <b>Withdrawal Rejected</b>\n\n` +
      `Your withdrawal request of <b>${Number(withdrawal.amount).toFixed(2)} USDT</b> has been rejected.\n` +
      `The amount has been returned to your balance.\n\n` +
      `💰 Current Balance: <b>${newBalance.toFixed(2)} USDT</b>` +
      (note ? `\n\n📝 <b>Reason:</b> ${note}` : "") +
      `\n\nContact support if you have questions.`;

    await notifyCustomer(supabase, {
      customer: { ...customer, balance: newBalance },
      telegram: { text: tgText, replyMarkup: mainMenuKeyboard() },
      email: {
        templateName: "withdrawal-rejected",
        templateData: {
          customerName: customer.first_name,
          amount: withdrawal.amount,
          newBalance,
          reason: note || undefined,
        },
      },
    });

    return new Response(JSON.stringify({ success: true, new_balance: newBalance }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Admin reject withdrawal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
