// Admin one-click credit for a "late_pending" deposit.
// Verifies caller is admin, credits the customer, marks deposit verified.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyDepositCredit } from "../_shared/apply-deposit-credit.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);

    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userRes.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const depositId = String(body?.deposit_id || "").trim();
    if (!depositId) return json({ error: "deposit_id required" }, 400);

    const { data: dep, error: depErr } = await admin
      .from("bot_deposits")
      .select("id, customer_id, amount, status")
      .eq("id", depositId)
      .maybeSingle();
    if (depErr || !dep) return json({ error: "deposit not found" }, 404);
    if (dep.status !== "late_pending") return json({ error: `deposit status is ${dep.status}, expected late_pending` }, 400);
    if (!dep.customer_id || !dep.amount || Number(dep.amount) <= 0) return json({ error: "invalid deposit" }, 400);

    const usd = Number(body?.amount_override ?? dep.amount);
    if (!isFinite(usd) || usd <= 0) return json({ error: "invalid amount" }, 400);

    const result = await applyDepositCredit(admin, dep.customer_id, usd);

    await admin.from("bot_deposits").update({
      status: "verified",
      verified_at: new Date().toISOString(),
      amount: usd,
    }).eq("id", depositId);

    // Notify customer
    try {
      const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
      const { data: cust } = await admin.from("bot_customers").select("chat_id").eq("id", dep.customer_id).maybeSingle();
      if (BOT_TOKEN && cust?.chat_id) {
        const plLine = result.paidPayLater > 0 ? `\n🏷️ Pay-Later Cleared: <b>$${result.paidPayLater.toFixed(2)}</b>` : "";
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: cust.chat_id,
            parse_mode: "HTML",
            text: `✅ <b>Late Payment Credited</b>\n\n💰 Credited: <b>$${usd.toFixed(2)}</b>${plLine}\n💳 New Balance: <b>$${result.newBalance.toFixed(2)}</b>`,
          }),
        });
      }
    } catch (e) { console.error("notify err", e); }

    return json({ ok: true, deposit_id: depositId, credited: usd, ...result });
  } catch (e) {
    console.error("credit-late-deposit fatal", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
