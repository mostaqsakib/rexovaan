import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  function add32(a: number, b: number) { return (a + b) & 0xffffffff; }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLen >>> (8 * i)) & 0xff);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < bytes.length; i += 64) {
    const x = Array.from({ length: 16 }, (_, j) => bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24));
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586); c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
    a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426); c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
    a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417); c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
    a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101); c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);
    a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632); c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
    a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083); c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
    a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690); c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
    a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784); c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);
    a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463); c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
    a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353); c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
    a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222); c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
    a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835); c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);
    a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415); c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
    a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606); c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
    a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744); c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
    a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379); c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);
    a = add32(a, oa); b = add32(b, ob); c = add32(c, oc); d = add32(d, od);
  }
  return [a, b, c, d].map((n) => Array.from({ length: 4 }, (_, i) => ((n >>> (i * 8)) & 255).toString(16).padStart(2, "0")).join("")).join("");
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
