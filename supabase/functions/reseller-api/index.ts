import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OrderSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  external_order_id: z.string().trim().min(1).max(120).optional(),
});

async function sha256Hex(value: string) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizeDelivery(details: unknown) {
  const items = Array.isArray(details) ? details : [];
  return items.map((item) => {
    if (item && typeof item === "object") {
      const values = Object.values(item as Record<string, unknown>)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      return values.join(" | ");
    }
    return String(item ?? "").trim();
  }).filter(Boolean);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getCustomerLabel(order: Record<string, unknown>, resellerName: string) {
  const username = String(order.customer_username || "").trim();
  const firstName = String(order.customer_first_name || "").trim();
  const chatId = String(order.customer_chat_id || "").trim();
  if (username) return `@${escapeHtml(username)}`;
  if (firstName) return escapeHtml(firstName);
  if (chatId) return `#${escapeHtml(chatId)}`;
  return escapeHtml(resellerName);
}

async function notifyAdminApiOrder(order: Record<string, unknown>, resellerName: string) {
  const botToken = (Deno.env.get("TELEGRAM_API_KEY_1") || Deno.env.get("TELEGRAM_API_KEY"));
  const adminChatId = Deno.env.get("ADMIN_CHAT_ID");
  if (!botToken || !adminChatId) return;

  const text = `📦 <b>New Order (API)</b>\n\n` +
    `👤 ${getCustomerLabel(order, resellerName)}\n` +
    `🛒 Product: <b>${escapeHtml(order.product_name)}</b> x${Number(order.quantity || 0)}\n` +
    `💰 Total: <b>${Number(order.total_cost || 0).toFixed(2)} USDT</b>\n` +
    `💳 Payment: <b>API Balance</b>\n` +
    `🛢️ Source: <b>API Order</b>`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(adminChatId), text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("api_order_admin_notify_failed", await res.text());
  } catch (error) {
    console.error("api_order_admin_notify_error", error);
  }
}

function getApiKey(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (req.headers.get("x-api-key") || "").trim();
}

async function purchaseFromSource(product: Record<string, unknown>, quantity: number) {
  if (!product.source_id || !product.source_product_id) return [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Server is not configured");

  const res = await fetch(`${supabaseUrl}/functions/v1/product-sources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
    },
    body: JSON.stringify({
      action: "purchase",
      source_id: product.source_id,
      source_product_id: product.source_product_id,
      quantity,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Source order failed (${res.status})`);
  return payload.accounts || [];
}

async function resolveLowestUnitPrice(
  supabase: ReturnType<typeof createClient>,
  product: Record<string, any>,
  quantity: number,
  customerId: string | null,
) {
  const candidates: number[] = [Number(product.price || 0)];
  const { data: tier } = await supabase
    .from('bot_product_pricing')
    .select('price')
    .eq('product_id', product.id)
    .lte('min_quantity', quantity)
    .order('min_quantity', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tier) candidates.push(Number(tier.price));

  if (customerId) {
    const { data: special } = await supabase
      .from('bot_customer_pricing')
      .select('price')
      .eq('customer_id', customerId)
      .eq('product_id', product.id)
      .eq('is_active', true)
      .lte('min_quantity', quantity)
      .order('min_quantity', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (special) candidates.push(Number(special.price));
  }

  const { data: flash } = await supabase
    .from('bot_flash_sales')
    .select('sale_price')
    .eq('product_id', product.id)
    .eq('is_active', true)
    .gte('ends_at', new Date().toISOString())
    .order('sale_price', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (flash) candidates.push(Number(flash.sale_price));

  return Math.min(...candidates.filter((v) => Number.isFinite(v) && v >= 0));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = getApiKey(req);
    if (!apiKey || apiKey.length < 32) return json({ ok: false, error: "Invalid API key" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server is not configured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey);
    const apiKeyHash = await sha256Hex(apiKey);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "products";

    const { data: reseller, error: resellerError } = await supabase
      .from("bot_resellers")
      .select("id,name,balance,is_active,customer_id")
      .eq("api_key_hash", apiKeyHash)
      .maybeSingle();

    if (resellerError) throw resellerError;
    if (!reseller || !reseller.is_active) return json({ ok: false, error: "Reseller account is not active" }, 401);

    let apiBalance = Number(reseller.balance || 0);
    if (reseller.customer_id) {
      const { data: customer, error: customerError } = await supabase
        .from("bot_customers")
        .select("balance")
        .eq("id", reseller.customer_id)
        .maybeSingle();
      if (customerError) throw customerError;
      if (customer) {
        apiBalance = Number(customer.balance || 0);
        if (apiBalance !== Number(reseller.balance || 0)) {
          await supabase.from("bot_resellers").update({ balance: apiBalance }).eq("id", reseller.id);
        }
      }
    }

    if (req.method === "GET" && action === "balance") {
      return json({ ok: true, reseller: { name: reseller.name, balance: apiBalance } });
    }

    if (req.method === "GET" && action === "products") {
      const { data: products, error: productsError } = await supabase
        .from("bot_products")
        .select("id,name,price,currency,description,delivery_instruction,delivery_media,is_manual_delivery,is_active,source_id,last_known_stock")
        .eq("is_active", true)
        .eq("is_manual_delivery", false)
        .order("sort_order", { ascending: true });

      if (productsError) throw productsError;
      const productIds = (products || []).map((product: any) => product.id);
      const stockByProduct = new Map<string, number>();
      if (productIds.length > 0) {
        // Use HEAD count per product to avoid the 1000-row default select limit
        const counts = await Promise.all(productIds.map(async (pid: string) => {
          const { count, error } = await supabase
            .from("bot_product_stock_items")
            .select("id", { count: "exact", head: true })
            .eq("status", "available")
            .eq("product_id", pid);
          if (error) throw error;
          return [pid, count || 0] as const;
        }));
        for (const [pid, c] of counts) stockByProduct.set(pid, c);
      }

      return json({
        ok: true,
        reseller: { name: reseller.name, balance: apiBalance },
        products: (products || []).map((product: any) => ({
          id: product.id,
          name: product.name,
          wholesale_price: Number(product.price || 0),
          currency: product.currency || "USDT",
          description: product.description || null,
          delivery_instruction: product.delivery_instruction || null,
          delivery_media: product.delivery_media || [],
          stock: product.source_id ? Number(product.last_known_stock || 0) : (stockByProduct.get(product.id) || 0),
        })),
      });
    }

    if (req.method === "POST" && action === "order") {
      const parsed = OrderSchema.safeParse(await req.json());
      if (!parsed.success) return json({ ok: false, error: "Invalid order payload", details: parsed.error.flatten().fieldErrors }, 400);

      const { data: product, error: productError } = await supabase
        .from("bot_products")
        .select("*")
        .eq("id", parsed.data.product_id)
        .eq("is_active", true)
        .single();
      if (productError || !product) return json({ ok: false, error: "Product not found or inactive" }, 404);

      if (product.source_id && product.source_product_id) {
        if (product.is_manual_delivery) return json({ ok: false, error: "Manual delivery products are not available via reseller API" }, 400);

        // Resolve unit price: always the LOWEST of base, tier, customer special, active flash.
        const unitPrice = await resolveLowestUnitPrice(supabase, product, parsed.data.quantity, reseller.customer_id || null);

        const totalCost = +(unitPrice * parsed.data.quantity).toFixed(2);
        if (apiBalance < totalCost) return json({ ok: false, error: "Insufficient reseller balance" }, 400);

        const accounts = await purchaseFromSource(product, parsed.data.quantity);
        if (!accounts.length || accounts.length < parsed.data.quantity) return json({ ok: false, error: "Not enough stock available" }, 409);

        const details = accounts.map((account: unknown) => ({ "Delivery Info": String(account) }));
        const newBalance = apiBalance - totalCost;
        const { data: apiOrder, error: orderError } = await supabase.from("bot_reseller_orders").insert({
          reseller_id: reseller.id,
          product_id: product.id,
          product_name: product.name,
          quantity: parsed.data.quantity,
          unit_cost: unitPrice,
          total_cost: totalCost,
          external_order_id: parsed.data.external_order_id || null,
          details,
          status: "completed",
        }).select("*").single();
        if (orderError) throw orderError;

        if (reseller.customer_id) {
          await supabase.from("bot_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", reseller.customer_id);
          await supabase.from("bot_orders").insert({ customer_id: reseller.customer_id, product_id: product.id, product_name: product.name, quantity: parsed.data.quantity, total_price: totalCost, details, row_numbers: [], status: "completed" });
        }
        await supabase.from("bot_resellers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", reseller.id);
        await supabase.from("bot_reseller_balance_transactions").insert({ reseller_id: reseller.id, order_id: apiOrder.id, type: "order_debit", amount: -totalCost, balance_after: newBalance, note: "Reseller API order" });

        const order = { ...apiOrder, balance_after: newBalance, accounts, account: accounts[0] };
        await notifyAdminApiOrder(order || {}, reseller.name);
        return json({ ok: true, order, accounts, account: accounts[0] });
      }

      const { data, error } = await supabase.rpc("place_reseller_api_order", {
        _api_key_hash: apiKeyHash,
        _product_id: parsed.data.product_id,
        _quantity: parsed.data.quantity,
        _external_order_id: parsed.data.external_order_id || null,
      });

      if (error) return json({ ok: false, error: error.message }, 400);
      const order = Array.isArray(data) ? data[0] : data;
      if (order?.balance_after !== undefined) {
        apiBalance = Number(order.balance_after || 0);
      }
      const accounts = normalizeDelivery(order?.details);
      if (!accounts.length) return json({ ok: false, error: "Not enough stock available" }, 409);

      // Apply lowest-price correction (RPC uses regular price). Refund the difference if cheaper.
      try {
        const lowestUnit = await resolveLowestUnitPrice(supabase, product, parsed.data.quantity, reseller.customer_id || null);
        const rpcUnit = Number(order?.unit_cost || product.price || 0);
        if (Number.isFinite(lowestUnit) && lowestUnit < rpcUnit) {
          const newTotal = +(lowestUnit * parsed.data.quantity).toFixed(2);
          const refund = +(Number(order?.total_cost || rpcUnit * parsed.data.quantity) - newTotal).toFixed(2);
          if (refund > 0) {
            const correctedBalance = +(apiBalance + refund).toFixed(2);
            await supabase.from("bot_reseller_orders").update({ unit_cost: lowestUnit, total_cost: newTotal }).eq("id", order.id);
            await supabase.from("bot_resellers").update({ balance: correctedBalance, updated_at: new Date().toISOString() }).eq("id", reseller.id);
            if (reseller.customer_id) {
              await supabase.from("bot_customers").update({ balance: correctedBalance, updated_at: new Date().toISOString() }).eq("id", reseller.customer_id);
              await supabase.from("bot_orders").update({ total_price: newTotal }).eq("id", order.order_id || order.id).eq("customer_id", reseller.customer_id);
            }
            await supabase.from("bot_reseller_balance_transactions").insert({ reseller_id: reseller.id, order_id: order.id, type: "price_adjustment", amount: refund, balance_after: correctedBalance, note: "Lowest-price adjustment (flash/special/tier)" });
            order.unit_cost = lowestUnit;
            order.total_cost = newTotal;
            order.balance_after = correctedBalance;
            apiBalance = correctedBalance;
          }
        }
      } catch (e) {
        console.error("reseller_api_price_adjust_failed", e);
      }

      await notifyAdminApiOrder(order || {}, reseller.name);
      return json({ ok: true, order: { ...order, accounts, account: accounts[0] }, accounts, account: accounts[0] });
    }

    return json({ ok: false, error: "Unsupported endpoint" }, 404);
  } catch (error) {
    console.error("reseller_api_error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
