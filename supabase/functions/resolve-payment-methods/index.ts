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

function resolvePaymentDetails(value: string) {
  const key = value.trim();
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(key)) return Deno.env.get(key) || value;
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Server is not configured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
      .from("bot_payment_methods")
      .select("id,name,emoji,custom_emoji_id,payment_type,payment_details,instruction,is_active,sort_order,created_at")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

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