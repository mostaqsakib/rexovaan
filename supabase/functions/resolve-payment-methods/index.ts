import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// IMPORTANT: do NOT resolve environment variables from DB values.
// An admin or DB compromise could otherwise exfiltrate any secret (incl. service-role)
// by setting payment_details to a secret name. Always return the literal string as stored.
function resolvePaymentDetails(value: string) {
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Server is not configured" }, 500);

    // Read optional context filter: 'purchase' | 'deposit'
    let context = "";
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        context = String(body?.context || "").toLowerCase();
      } else {
        const url = new URL(req.url);
        context = String(url.searchParams.get("context") || "").toLowerCase();
      }
    } catch { /* ignore */ }

    const supabase = createClient(supabaseUrl, serviceKey);
    let query = supabase
      .from("bot_payment_methods")
      .select("id,name,emoji,custom_emoji_id,payment_type,payment_details,instruction,is_active,enabled_for_purchase,enabled_for_deposit,sort_order,created_at")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (context === "purchase") query = query.eq("enabled_for_purchase", true);
    else if (context === "deposit") query = query.eq("enabled_for_deposit", true);

    const { data, error } = await query;
    if (error) throw error;

    return json({
      methods: (data || []).map((method) => ({
        ...method,
        payment_details: resolvePaymentDetails(String(method.payment_details || "")),
      })),
    });
  } catch (error) {
    console.error("resolve-payment-methods error", error);
    return json({ error: "Failed to load payment methods" }, 500);
  }
});