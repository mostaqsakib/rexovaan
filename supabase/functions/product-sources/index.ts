import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/require-admin.ts";

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

function buildAuthHeaders(source: any): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const headerName = source.auth_header || "Authorization";
  const prefix = source.auth_prefix ?? "Bearer ";
  headers[headerName] = `${prefix}${source.api_key}`;
  return headers;
}

// Try to extract a product list from a heterogeneous JSON response.
function extractProducts(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normalizeProduct(raw: any) {
  return {
    id: String(raw.id ?? raw.product_id ?? raw.uuid ?? ""),
    name: String(raw.name ?? raw.title ?? raw.product_name ?? "Unnamed"),
    price: Number(raw.wholesale_price ?? raw.price ?? raw.cost ?? 0),
    currency: String(raw.currency ?? "USDT"),
    stock: Number(raw.stock ?? raw.available ?? raw.quantity ?? 0),
    description: raw.description ?? null,
    delivery_instruction: raw.delivery_instruction ?? raw.instruction ?? null,
    delivery_media: Array.isArray(raw.delivery_media) ? raw.delivery_media : [],
  };
}

async function fetchProductList(source: any) {
  const url = source.base_url.replace(/\/+$/, "") + (source.kind === "lovable" ? "?action=products" : "");
  const res = await fetch(url, { method: "GET", headers: buildAuthHeaders(source) });
  const text = await res.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!res.ok) throw new Error(`Source returned ${res.status}: ${text.slice(0, 200)}`);
  const list = extractProducts(payload).map(normalizeProduct).filter((p) => p.id);
  const balance = Number(payload?.reseller?.balance ?? payload?.balance ?? 0) || null;
  return { products: list, balance };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const _adminGuard = await requireAdmin(req, corsHeaders);
  if (_adminGuard) return _adminGuard;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const { action, source_id, source, product_ids, quantity, source_product_id } = body;

    // Periodic sync: loop through all active sources, refresh balance + linked product stocks.
    if (action === "sync_all") {
      const { data: srcs } = await supabase.from("bot_product_sources").select("*").eq("is_active", true);
      const results: any[] = [];
      for (const src of srcs || []) {
        try {
          const { products, balance } = await fetchProductList(src);
          await supabase.from("bot_product_sources")
            .update({ last_balance: balance, last_checked_at: new Date().toISOString() })
            .eq("id", src.id);
          const { data: linked } = await supabase.from("bot_products")
            .select("id, source_product_id").eq("source_id", src.id);
          if (linked && linked.length > 0) {
            const map = new Map(products.map((p: any) => [p.id, p]));
            await Promise.all(linked.map((row: any) => {
              const p = map.get(row.source_product_id);
              if (!p) return Promise.resolve();
              return supabase.from("bot_products").update({
                last_known_stock: Number(p.stock) || 0,
                source_price: Number(p.price) || 0,
                description: p.description ?? null,
                delivery_instruction: p.delivery_instruction ?? null,
                delivery_media: p.delivery_media ?? [],
              }).eq("id", row.id);
            }));
          }
          results.push({ source_id: src.id, ok: true, count: products.length });
        } catch (err) {
          results.push({ source_id: src.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return json({ ok: true, results });
    }


    // Test/list with provided credentials (before saving).
    if (action === "test") {
      const { products, balance } = await fetchProductList(source);
      return json({ ok: true, products, balance });
    }

    // List products for an existing saved source.
    if (action === "list") {
      const { data: src } = await supabase.from("bot_product_sources").select("*").eq("id", source_id).single();
      if (!src) return json({ ok: false, error: "Source not found" }, 404);
      const { products, balance } = await fetchProductList(src);
      await supabase.from("bot_product_sources")
        .update({ last_balance: balance, last_checked_at: new Date().toISOString() })
        .eq("id", source_id);
      // Update last_known_stock on locally imported products linked to this source.
      const { data: linked } = await supabase.from("bot_products")
        .select("id, source_product_id").eq("source_id", source_id);
      if (linked && linked.length > 0) {
        const map = new Map(products.map((p: any) => [p.id, p]));
        await Promise.all(linked.map((row: any) => {
          const p = map.get(row.source_product_id);
          if (!p) return Promise.resolve();
          return supabase.from("bot_products").update({
            last_known_stock: Number(p.stock) || 0,
            source_price: Number(p.price) || 0,
            description: p.description ?? null,
            delivery_instruction: p.delivery_instruction ?? null,
            delivery_media: p.delivery_media ?? [],
          }).eq("id", row.id);
        }));
      }
      return json({ ok: true, products, balance });
    }

    // Import selected products as new local products linked to this source.
    if (action === "import") {
      const { data: src } = await supabase.from("bot_product_sources").select("*").eq("id", source_id).single();
      if (!src) return json({ ok: false, error: "Source not found" }, 404);
      const { products } = await fetchProductList(src);
      const selected = products.filter((p) => (product_ids as string[]).includes(p.id));
      const { data: maxRow } = await supabase.from("bot_products").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      let nextOrder = ((maxRow?.[0]?.sort_order as number) || 0) + 1;

      const inserts = selected.map((p) => ({
        name: p.name,
        sheet_tab: `src_${src.id.slice(0, 8)}_${p.id}`.slice(0, 60),
        stock_source: "internal",
        is_manual_delivery: false,
        is_active: true,
        sort_order: nextOrder++,
        detail_columns: ["Delivery Info"],
        sold_column: "",
        sold_value: "",
        price: 0, // user sets manually
        description: p.description,
        delivery_instruction: p.delivery_instruction ?? null,
        delivery_media: p.delivery_media ?? [],
        source_id: src.id,
        source_product_id: p.id,
        source_price: Number(p.price) || 0,
        last_known_stock: Number(p.stock) || 0,
      }));

      const { data: inserted, error } = await supabase
        .from("bot_products")
        .upsert(inserts, { onConflict: "source_id,source_product_id", ignoreDuplicates: true })
        .select("id, name");
      if (error) throw error;
      return json({ ok: true, imported: inserted });
    }

    // Proxy purchase one item from the source — used by bot at delivery time.
    if (action === "purchase") {
      const { data: src } = await supabase.from("bot_product_sources").select("*").eq("id", source_id).single();
      if (!src) return json({ ok: false, error: "Source not found" }, 404);
      const url = src.base_url.replace(/\/+$/, "") + (src.kind === "lovable" ? "?action=order" : "");
      const res = await fetch(url, {
        method: "POST",
        headers: buildAuthHeaders(src),
        body: JSON.stringify({ product_id: source_product_id, quantity: quantity || 1 }),
      });
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
      if (!res.ok || payload?.ok === false) {
        return json({ ok: false, error: payload?.error || `Source order failed (${res.status})`, raw: payload }, 400);
      }
      // Normalize details: try common fields in priority order.
      const toStr = (d: any) => typeof d === "string" ? d : (d && typeof d === "object" ? Object.values(d).filter(v => v != null && v !== "").join(" | ") : String(d ?? ""));
      let accounts: string[] = [];
      if (Array.isArray(payload.accounts) && payload.accounts.length) {
        accounts = payload.accounts.map(toStr);
      } else if (Array.isArray(payload.order?.accounts) && payload.order.accounts.length) {
        accounts = payload.order.accounts.map(toStr);
      } else if (Array.isArray(payload.order?.details) && payload.order.details.length) {
        accounts = payload.order.details.map(toStr);
      } else if (Array.isArray(payload.details) && payload.details.length) {
        accounts = payload.details.map(toStr);
      } else if (Array.isArray(payload.items) && payload.items.length) {
        accounts = payload.items.map(toStr);
      } else if (Array.isArray(payload.data) && payload.data.length) {
        accounts = payload.data.map(toStr);
      } else if (payload.account) {
        accounts = [toStr(payload.account)];
      }
      accounts = accounts.filter((a) => a && a.trim().length > 0);
      if (!accounts.length) {
        return json({ ok: false, error: "Source returned no account details", raw: payload }, 400);
      }
      return json({ ok: true, accounts, raw: payload });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("product_sources_error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
