import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyCustomer } from "../_shared/notify-customer.ts";
import { requireAdmin } from "../_shared/require-admin.ts";
import { logAdminAction } from "../_shared/audit-log.ts";
import { renderTemplate } from "../_shared/render-template.ts";

const DEFAULT_CREDIT = `💰 <b>Balance Credited</b>

Previous: <b>{old_balance} USDT</b>
New: <b>{new_balance} USDT</b>
Change: <b>+{diff} USDT</b>

📝 <b>Note:</b> {note}`;

const DEFAULT_DEBIT = `💸 <b>Balance Debited</b>

Previous: <b>{old_balance} USDT</b>
New: <b>{new_balance} USDT</b>
Change: <b>{diff} USDT</b>

📝 <b>Note:</b> {note}`;

const DEFAULT_ADJUST = `ℹ️ <b>Balance Adjusted</b>

Previous: <b>{old_balance} USDT</b>
New: <b>{new_balance} USDT</b>

📝 <b>Note:</b> {note}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const _adminGuard = await requireAdmin(req, corsHeaders);
  if (_adminGuard) return _adminGuard;

  try {
    const { customer_id, new_balance, note, skip_notify } = await req.json();

    if (!customer_id || new_balance === undefined || new_balance === null) {
      return new Response(JSON.stringify({ error: "customer_id and new_balance required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const hasNote = !!(note && String(note).trim());
    const silent = skip_notify === true || !hasNote;
    if (!silent && !hasNote) {
      return new Response(JSON.stringify({ error: "Note is required for balance edits (or set skip_notify=true)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Negative balances are allowed (represent a due/amount owed by the customer).

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: customer, error: custErr } = await supabase.from("bot_customers").select("*").eq("id", customer_id).single();
    if (custErr || !customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const oldBalance = Number(customer.balance);
    const newBal = Number(new_balance);
    const diff = newBal - oldBalance;

    await supabase.from("bot_customers").update({ balance: newBal, updated_at: new Date().toISOString() }).eq("id", customer_id);

    const noteText = hasNote ? String(note).trim() : (silent ? "(silent admin adjustment)" : "");

    await supabase.from("bot_balance_adjustments").insert({
      customer_id,
      old_balance: oldBalance,
      new_balance: newBal,
      diff,
      note: noteText,
      source: "admin",
    });

    await logAdminAction(supabase, req, {
      action: "edit_balance",
      target_table: "bot_customers",
      target_id: customer_id,
      before: { balance: oldBalance },
      after: { balance: newBal },
      note: noteText,
    });

    if (!silent) {
      const key = diff > 0 ? "notif_balance_credit" : diff < 0 ? "notif_balance_debit" : "notif_balance_adjust";
      const defaultTpl = diff > 0 ? DEFAULT_CREDIT : diff < 0 ? DEFAULT_DEBIT : DEFAULT_ADJUST;
      const tgMsg = await renderTemplate(supabase, key, defaultTpl, {
        old_balance: oldBalance.toFixed(2),
        new_balance: newBal.toFixed(2),
        diff: (diff >= 0 ? "+" : "") + diff.toFixed(2),
        abs_diff: Math.abs(diff).toFixed(2),
        note: noteText,
        name: customer.first_name || "",
      });

      await notifyCustomer(supabase, {
        customer,
        telegram: { text: tgMsg },
        email: {
          templateName: "balance-adjustment",
          templateData: {
            customerName: customer.first_name,
            oldBalance,
            newBalance: newBal,
            diff,
            note: noteText,
          },
        },
      });
    }

    return new Response(JSON.stringify({ success: true, old_balance: oldBalance, new_balance: newBal, diff }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Balance edit error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
