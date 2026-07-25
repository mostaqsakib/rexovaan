import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyCustomer } from "../_shared/notify-customer.ts";
import { requireAdmin } from "../_shared/require-admin.ts";
import { renderTemplate } from "../_shared/render-template.ts";

const DEFAULTS: Record<string, string> = {
  set: `🎁 <b>Special Price Unlocked</b>

Product: <b>{product}</b>
Your Price: <b>{special} USDT</b>{savings_block}
Regular: <s>{regular} USDT</s>{moq_block}{note_block}`,
  updated: `🔄 <b>Special Price Updated</b>

Product: <b>{product}</b>
New Price: <b>{special} USDT</b>{savings_block}
Regular: <s>{regular} USDT</s>{moq_block}`,
  enabled: `✅ <b>Special Price Re-Enabled</b>

Product: <b>{product}</b>
Your Price: <b>{special} USDT</b>`,
  disabled: `⏸️ <b>Special Price Paused</b>

Product: <b>{product}</b>
You will now see the regular price: <b>{regular} USDT</b>`,
  removed: `❌ <b>Special Price Removed</b>

Product: <b>{product}</b>
You will now see the regular price: <b>{regular} USDT</b>`,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action = "set" | "updated" | "removed" | "disabled" | "enabled";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const guard = await requireAdmin(req, corsHeaders);
  if (guard) return guard;

  try {
    const { customer_id, product_id, price, min_quantity, note, action } = await req.json() as {
      customer_id: string; product_id: string; price?: number; min_quantity?: number; note?: string | null; action: Action;
    };
    if (!customer_id || !product_id || !action) {
      return new Response(JSON.stringify({ error: "customer_id, product_id, action required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: customer }, { data: product }] = await Promise.all([
      supabase.from("bot_customers").select("*").eq("id", customer_id).maybeSingle(),
      supabase.from("bot_products").select("id, name, price").eq("id", product_id).maybeSingle(),
    ]);
    if (!customer || !product) {
      return new Response(JSON.stringify({ error: "Customer or product not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const regular = Number(product.price || 0);
    const special = Number(price ?? 0);
    const moq = Math.max(1, Math.floor(Number(min_quantity ?? 1)));
    const savings = regular > 0 && special > 0 && special < regular
      ? `${(((regular - special) / regular) * 100).toFixed(0)}% off`
      : null;

    const key = `notif_special_price_${action}`;
    const fallback = DEFAULTS[action] || DEFAULTS.set;
    const tgText = await renderTemplate(supabase, key, fallback, {
      product: product.name,
      special: special.toFixed(2),
      regular: regular.toFixed(2),
      savings: savings || "",
      savings_block: savings ? ` (${savings})` : "",
      moq: String(moq),
      moq_block: moq > 1 ? `\nMin Quantity: <b>${moq}</b>` : "",
      note: note || "",
      note_block: note ? `\n\n📝 ${note}` : "",
      name: customer.first_name || "",
    });

    const result = await notifyCustomer(supabase, {
      customer,
      telegram: { text: tgText },
    });

    return new Response(JSON.stringify({ ok: true, result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("admin-notify-special-price error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
