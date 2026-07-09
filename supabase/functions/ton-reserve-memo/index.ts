import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function getTonAddress(): Promise<string | null> {
  const { data } = await supabase
    .from("bot_settings")
    .select("value")
    .eq("key", "usdt_ton_address")
    .maybeSingle();

  return (data?.value || Deno.env.get("USDT_TON_ADDRESS") || "").trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const customerId: string = body.customer_id;
    const expectedAmount: number = Number(body.expected_amount);
    if (!customerId || !Number.isFinite(expectedAmount) || expectedAmount < 1) {
      return new Response(JSON.stringify({ error: "customer_id and expected_amount>=1 required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tonAddress = await getTonAddress();
    if (!tonAddress) {
      return new Response(JSON.stringify({ error: "USDT_TON_ADDRESS not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate unique 6-digit memo (try up to 8 times)
    let memo = "";
    for (let i = 0; i < 8; i++) {
      const candidate = String(Math.floor(100000 + Math.random() * 900000));
      const { data: exists } = await supabase
        .from("ton_reserved_deposits")
        .select("id")
        .eq("memo", candidate)
        .eq("status", "pending")
        .maybeSingle();
      if (!exists) { memo = candidate; break; }
    }
    if (!memo) {
      return new Response(JSON.stringify({ error: "Failed to allocate unique memo" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Create pending deposit record
    const { data: deposit, error: depErr } = await supabase
      .from("bot_deposits")
      .insert({
        customer_id: customerId,
        amount: expectedAmount,
        payment_method: "USDT TON",
        status: "pending",
      })
      .select("id")
      .single();
    if (depErr) throw depErr;

    const { error: resErr } = await supabase.from("ton_reserved_deposits").insert({
      customer_id: customerId,
      deposit_id: deposit.id,
      memo,
      expected_amount: expectedAmount,
      expires_at: expiresAt,
    });
    if (resErr) throw resErr;

    return new Response(JSON.stringify({
      address: tonAddress,
      memo,
      expected_amount: expectedAmount,
      expires_at: expiresAt,
      deposit_id: deposit.id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
