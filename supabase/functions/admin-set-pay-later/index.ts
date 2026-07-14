import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/require-admin.ts";
import { logAdminAction } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = await requireAdmin(req, corsHeaders);
  if (guard) return guard;

  try {
    const { customer_id, enabled, limit } = await req.json();
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const newLimit = Math.max(0, Number(limit) || 0);
    const newEnabled = !!enabled;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: customer, error: custErr } = await supabase.from("bot_customers").select("id, pay_later_enabled, pay_later_limit, pay_later_used").eq("id", customer_id).single();
    if (custErr || !customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: updErr } = await supabase.from("bot_customers").update({
      pay_later_enabled: newEnabled,
      pay_later_limit: newLimit,
      updated_at: new Date().toISOString(),
    }).eq("id", customer_id);
    if (updErr) throw updErr;

    await logAdminAction(supabase, req, {
      action: "set_pay_later",
      target_table: "bot_customers",
      target_id: customer_id,
      before: { pay_later_enabled: customer.pay_later_enabled, pay_later_limit: Number(customer.pay_later_limit) },
      after: { pay_later_enabled: newEnabled, pay_later_limit: newLimit },
    });

    return new Response(JSON.stringify({ success: true, pay_later_enabled: newEnabled, pay_later_limit: newLimit }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("set_pay_later error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
