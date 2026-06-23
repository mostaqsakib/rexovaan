import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BKASH_BASE = "https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getBkashToken(): Promise<string | null> {
  const appKey = Deno.env.get("BKASH_APP_KEY");
  const appSecret = Deno.env.get("BKASH_APP_SECRET");
  const username = Deno.env.get("BKASH_USERNAME");
  const password = Deno.env.get("BKASH_PASSWORD");
  if (!appKey || !appSecret || !username || !password) return null;

  const res = await fetch(`${BKASH_BASE}/token/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", username, password },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id_token || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const authUserId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const amountBDT = Number(body?.amount_bdt);
    if (!amountBDT || amountBDT <= 0) return json({ error: "Enter a valid BDT amount" }, 400);
    if (amountBDT < 10) return json({ error: "Minimum amount is 10 BDT" }, 400);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: customer } = await admin
      .from("bot_customers")
      .select("id, is_banned")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);
    if (customer.is_banned) return json({ error: "Account banned" }, 403);

    const missing = ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD"].filter(
      (k) => !Deno.env.get(k),
    );
    if (missing.length) return json({ error: `bKash not configured (${missing.join(", ")})` }, 500);

    const token = await getBkashToken();
    if (!token) return json({ error: "Could not get bKash token" }, 502);

    const appKey = Deno.env.get("BKASH_APP_KEY")!;
    const callbackURL = `${supabaseUrl}/functions/v1/bkash-callback`;
    const invoiceNumber = `INV${Date.now()}`;

    const res = await fetch(`${BKASH_BASE}/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        authorization: token,
        "x-app-key": appKey,
      },
      body: JSON.stringify({
        mode: "0011",
        payerReference: String(customer.id),
        callbackURL,
        amount: amountBDT.toFixed(2),
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: invoiceNumber,
      }),
    });
    const data = await res.json();
    console.log("[bKash] create response:", JSON.stringify(data));

    const nested = data?.data && typeof data.data === "object" ? data.data : {};
    const paymentID = data.paymentID || data.paymentId || nested.paymentID || nested.paymentId || null;
    const bkashURL =
      data.bkashURL || data.paymentURL || data.redirectURL ||
      nested.bkashURL || nested.paymentURL || nested.redirectURL || null;
    const errMsg = data.statusMessage || data.errorMessage || nested.statusMessage || nested.errorMessage;

    if (!res.ok || !paymentID || !bkashURL) {
      return json({ error: errMsg || "bKash did not return a payment URL" }, 502);
    }

    const { error: depErr } = await admin.from("bot_deposits").insert({
      customer_id: customer.id,
      amount: 0,
      status: "bkash_pending",
      txn_hash: `bkash_${paymentID}`,
      source: "web",
    });
    if (depErr) {
      console.error("[bKash] deposit insert failed", depErr);
      return json({ error: "Could not save pending deposit" }, 500);
    }

    return json({ bkashURL, paymentID });
  } catch (e) {
    console.error("bkash-create-payment error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
