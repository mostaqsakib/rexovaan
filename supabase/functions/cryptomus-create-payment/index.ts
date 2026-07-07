import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.208.0/hash/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRYPTOMUS_API = "https://api.cryptomus.com/v1/payment";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://rexovaan.com").replace(/\/$/, "");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function md5(input: string): string {
  const h = createHash("md5");
  h.update(input);
  return h.toString();
}

function sign(bodyJson: string, apiKey: string): string {
  // Cryptomus: md5( base64(request_body_json) + PAYMENT_API_KEY )
  const b64 = btoa(bodyJson);
  return md5(b64 + apiKey);
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isServiceRoleToken(token: string): boolean {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && token === serviceRoleKey) return true;
  try {
    const [, payload] = token.split(".");
    if (!payload) return false;
    const pad = "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + pad));
    return decoded?.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const token = getBearerToken(req);
    if (!authHeader?.startsWith("Bearer ") || !token) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const isServiceRole = isServiceRoleToken(token);

    const body = await req.json().catch(() => ({}));
    const amountUSD = Number(body?.amount_usd);
    if (!amountUSD || amountUSD <= 0) return json({ error: "Enter a valid USD amount" }, 400);
    if (amountUSD < 0.5) return json({ error: "Minimum amount is $0.50" }, 400);

    const MERCHANT = Deno.env.get("CRYPTOMUS_MERCHANT_ID");
    const API_KEY = Deno.env.get("CRYPTOMUS_PAYMENT_API_KEY");
    if (!MERCHANT || !API_KEY) return json({ error: "Cryptomus not configured" }, 500);

    let customerQuery = admin.from("bot_customers").select("id, is_banned");
    if (isServiceRole) {
      const customerId = String(body?.customer_id || "");
      if (!customerId) return json({ error: "customer_id required for bot checkout" }, 400);
      customerQuery = customerQuery.eq("id", customerId);
    } else {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      customerQuery = customerQuery.eq("auth_user_id", userData.user.id);
    }

    const { data: customer } = await customerQuery.maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);
    if (customer.is_banned) return json({ error: "Account banned" }, 403);

    const orderId = `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const callbackURL = `${supabaseUrl}/functions/v1/cryptomus-webhook`;
    const source = body?.source === "bot" ? "bot" : "web";
    const botUsername = Deno.env.get("BOT_USERNAME") || "";
    const botURL = botUsername ? `https://t.me/${botUsername}` : SITE_URL;
    const returnURL = source === "bot" ? botURL : `${SITE_URL}/deposit?crypto=return&order=${orderId}`;
    const successURL = source === "bot" ? botURL : `${SITE_URL}/deposit?crypto=success&order=${orderId}`;

    const payload = {
      amount: amountUSD.toFixed(2),
      currency: "USD",
      order_id: orderId,
      url_callback: callbackURL,
      url_return: returnURL,
      url_success: successURL,
      lifetime: 3600,
    };
    const bodyJson = JSON.stringify(payload);
    const signature = sign(bodyJson, API_KEY);

    const res = await fetch(CRYPTOMUS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        merchant: MERCHANT,
        sign: signature,
      },
      body: bodyJson,
    });
    const data = await res.json();
    console.log("[Cryptomus] create response:", JSON.stringify(data));

    if (!res.ok || !data?.result?.url) {
      const msg = data?.message || data?.errors ? JSON.stringify(data.errors || data.message) : "Cryptomus did not return a payment URL";
      return json({ error: msg }, 502);
    }

    const { error: depErr } = await admin.from("bot_deposits").insert({
      customer_id: customer.id,
      amount: 0,
      status: "cryptomus_pending",
      txn_hash: `cryptomus_${orderId}`,
      source,
      pending_product_id: isServiceRole && body?.pending_product_id ? String(body.pending_product_id) : null,
      pending_quantity: isServiceRole && body?.pending_quantity ? Number(body.pending_quantity) : null,
      via: "Cryptomus",
    });
    if (depErr) {
      console.error("[Cryptomus] deposit insert failed", depErr);
      return json({ error: "Could not save pending deposit" }, 500);
    }

    return json({ url: data.result.url, order_id: orderId, uuid: data.result.uuid });
  } catch (e) {
    console.error("cryptomus-create-payment error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
