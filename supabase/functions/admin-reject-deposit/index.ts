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
    const { deposit_id, note } = await req.json();
    if (!deposit_id) {
      return new Response(JSON.stringify({ error: "deposit_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: deposit } = await supabase.from("bot_deposits").select("*, customer:bot_customers(*)").eq("id", deposit_id).single();
    if (!deposit) {
      return new Response(JSON.stringify({ error: "Deposit not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("bot_deposits").update({ status: "rejected" }).eq("id", deposit_id);

    if (deposit.customer_id) {
      await supabase.from("bot_customers").update({ pending_action: null }).eq("id", deposit.customer_id);
    }

    const customer = deposit.customer;
    if (customer) {
      const tgText = `❌ <b>Deposit Rejected</b>\n\n` +
        `Your deposit${deposit.txn_hash ? ` (TxID: <code>${deposit.txn_hash}</code>)` : ''} has been rejected by admin.` +
        (note ? `\n\n📝 <b>Reason:</b> ${note}` : '') +
        `\n\nIf you believe this is an error, please contact support.`;

      await notifyCustomer(supabase, {
        customer,
        telegram: { text: tgText, replyMarkup: mainMenuKeyboard() },
        email: {
          templateName: "deposit-rejected",
          templateData: {
            customerName: customer.first_name,
            amount: deposit.amount,
            txnHash: deposit.txn_hash,
            reason: note || undefined,
          },
        },
      });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Reject deposit error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
