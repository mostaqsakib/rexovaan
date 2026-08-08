// Admin-only: manually record + verify a deposit that auto-verification missed
// (e.g. Bybit Pay order IDs the API never exposes). Creates the bot_deposits
// row, credits the customer (pay-later aware) and notifies them on Telegram.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/require-admin.ts";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const guard = await requireAdmin(req, corsHeaders);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const customerId = String(body?.customer_id || "").trim();
    const amount = Number(body?.amount || 0);
    const txnHash = String(body?.txn_hash || "").trim();
    const method = String(body?.payment_method || "").trim();

    if (!customerId) return json({ error: "customer_id required" }, 400);
    if (!(amount > 0) || amount > 100000) return json({ error: "Invalid amount" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: customer } = await supabase
      .from("bot_customers")
      .select("id, chat_id, username, first_name")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    // Refuse if this TxID was already credited somewhere.
    if (txnHash) {
      const { data: dupe } = await supabase
        .from("bot_deposits")
        .select("id, status")
        .or(`txn_hash.eq.${txnHash},external_ref.eq.${txnHash}`)
        .eq("status", "verified")
        .maybeSingle();
      if (dupe) return json({ error: "This TxID / Order ID is already verified" }, 409);
    }

    const { data: deposit, error: insErr } = await supabase
      .from("bot_deposits")
      .insert({
        customer_id: customerId,
        amount,
        txn_hash: txnHash || null,
        external_ref: txnHash || null,
        status: "verified",
        verified_at: new Date().toISOString(),
        payment_method: method || null,
        via: method ? `${method} (manual)` : "Manual (admin)",
        source: "admin",
      })
      .select("id")
      .single();
    if (insErr) return json({ error: insErr.message }, 400);

    const applied = await applyDepositCredit(supabase, customerId, amount);

    let notified = false;
    const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (BOT_TOKEN && customer.chat_id) {
      const plLine = applied.paidPayLater > 0
        ? `\n🏷️ Pay Later Cleared: <b>${applied.paidPayLater.toFixed(2)} USDT</b>`
        : "";
      const text =
        `✅ <b>Deposit Verified by Admin!</b>\n\n` +
        `💰 Amount: <b>${amount.toFixed(2)} USDT</b>\n` +
        (method ? `🏦 Via: <b>${escapeHtml(method)}</b>\n` : "") +
        (txnHash ? `🔗 Ref: <code>${escapeHtml(txnHash)}</code>\n` : "") +
        plLine +
        `\n💳 New Balance: <b>${applied.newBalance.toFixed(2)} USDT</b>`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: customer.chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      notified = res.ok;
    }

    return json({ success: true, deposit_id: deposit.id, ...applied, notified });
  } catch (e) {
    console.error("admin-manual-deposit error", e);
    return json({ error: e instanceof Error ? e.message : "Failed" }, 500);
  }
});
