// Reserve a per-deposit BEP20 address for a customer.
// Body: { customer_id: uuid, expected_amount: number, token?: 'USDT'|'USDC'|'ANY' }
// Returns: { address, derivation_index, token, expected_amount, expires_at, deposit_id }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deriveAddress } from "../_bep20/derive.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { requireCustomerAuth } = await import("../_shared/require-caller.ts");
    const authz = await requireCustomerAuth(req);
    if (!authz.ok) return json({ error: authz.error }, authz.status);

    const { customer_id: bodyCustomerId, expected_amount, token = "ANY", pending_product_id = null, pending_quantity = null } = await req.json();
    if (!expected_amount || expected_amount <= 0) {
      return json({ error: "positive expected_amount required" }, 400);
    }
    const t = String(token).toUpperCase();
    if (!["USDT", "USDC", "ANY"].includes(t)) return json({ error: "token must be USDT|USDC|ANY" }, 400);

    const xpub = Deno.env.get("BSC_SWEEP_XPUB") || Deno.env.get("BSC_XPUB");
    if (!xpub) return json({ error: "BSC_SWEEP_XPUB not configured" }, 500);


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve customer_id: for user-token callers, look it up from auth_user_id and
    // ignore any body-supplied value (prevents targeting another customer's account).
    let customer_id: string | null = null;
    if (authz.mode === "user") {
      const { data: c } = await supabase
        .from("bot_customers").select("id").eq("auth_user_id", authz.authUserId).maybeSingle();
      if (!c?.id) return json({ error: "Customer not found for this user" }, 404);
      customer_id = c.id;
    } else {
      if (!bodyCustomerId) return json({ error: "customer_id required" }, 400);
      customer_id = bodyCustomerId;
    }


    // Reuse an existing pending reservation for this customer if still valid + same token/amount
    const { data: existing } = await supabase
      .from("bep20_reserved_addresses")
      .select("*")
      .eq("customer_id", customer_id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && Number(existing.expected_amount) === Number(expected_amount) && existing.token === t) {
      return json({
        address: existing.address,
        derivation_index: existing.derivation_index,
        token: existing.token,
        expected_amount: Number(existing.expected_amount),
        expires_at: existing.expires_at,
        deposit_id: existing.deposit_id,
        reused: true,
      });
    }

    const { data: settings } = await supabase
      .from("bep20_settings").select("address_ttl_minutes").eq("id", 1).maybeSingle();
    const ttl = settings?.address_ttl_minutes ?? 30;

    const { data: idxRow, error: idxErr } = await supabase.rpc("bep20_next_index");
    if (idxErr) return json({ error: "index alloc failed: " + idxErr.message }, 500);
    const index = Number(idxRow);
    const address = deriveAddress(xpub, index);

    // Create pending deposit row
    const { data: dep, error: depErr } = await supabase
      .from("bot_deposits")
      .insert({
        customer_id,
        amount: expected_amount,
        payment_method: "BEP20 " + t,
        status: "pending",
        bep20_address: address,
        bep20_token: t === "ANY" ? null : t,
        pending_product_id: pending_product_id || null,
        pending_quantity: pending_quantity || null,
      } as any)
      .select("id")
      .single();
    if (depErr) return json({ error: "deposit create failed: " + depErr.message }, 500);

    const expires_at = new Date(Date.now() + ttl * 60_000).toISOString();
    const { error: resErr } = await supabase.from("bep20_reserved_addresses").insert({
      customer_id,
      deposit_id: dep.id,
      address,
      derivation_index: index,
      token: t,
      expected_amount,
      expires_at,
    });
    if (resErr) return json({ error: "reserve failed: " + resErr.message }, 500);

    return json({
      address,
      derivation_index: index,
      token: t,
      expected_amount,
      expires_at,
      deposit_id: dep.id,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
