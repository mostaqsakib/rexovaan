// Mirrors changed rows from the OLD Supabase project into the NEW one.
// Watermark-based polling: per-table last `updated_at` (or `created_at`) tracked
// in public.sync_watermarks. Only changed rows pulled — idle = ~zero cost.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
};

const OLD_URL = Deno.env.get("OLD_SUPABASE_URL")!;
const OLD_KEY = Deno.env.get("OLD_SUPABASE_SERVICE_ROLE_KEY")!;
const NEW_URL = Deno.env.get("SUPABASE_URL")!;
const NEW_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Tables to mirror, in dependency order (parents before children).
// `watermark` is the column we paginate by. Use the most "latest-touched"
// timestamp the table has.
const TABLES: { name: string; watermark: string; conflict?: string }[] = [
  { name: "bot_settings", watermark: "updated_at" },
  { name: "bot_products", watermark: "updated_at" },
  { name: "bot_product_sources", watermark: "updated_at" },
  { name: "bot_product_pricing", watermark: "updated_at" },
  { name: "bot_payment_methods", watermark: "updated_at" },
  { name: "bot_flash_sales", watermark: "updated_at" },
  { name: "bot_broadcast_groups", watermark: "updated_at" },
  { name: "bot_keyword_triggers", watermark: "updated_at" },
  { name: "bot_notification_settings", watermark: "updated_at" },
  { name: "bot_button_emojis", watermark: "updated_at" },
  { name: "bot_custom_emoji_cache", watermark: "updated_at" },
  { name: "site_announcements", watermark: "updated_at" },
  { name: "telegram_bot_state", watermark: "updated_at" },

  { name: "bot_customers", watermark: "updated_at" },
  { name: "bot_customer_pricing", watermark: "updated_at" },
  { name: "customer_announcement_reads", watermark: "created_at" },

  { name: "bot_product_stock_items", watermark: "updated_at" },

  { name: "bot_orders", watermark: "created_at" },
  { name: "bot_deposits", watermark: "updated_at" },
  { name: "bot_withdrawals", watermark: "updated_at" },
  { name: "bot_balance_adjustments", watermark: "created_at" },

  { name: "bot_referrals", watermark: "created_at" },
  { name: "bot_referral_earnings", watermark: "created_at" },

  { name: "bot_resellers", watermark: "updated_at" },
  { name: "bot_reseller_orders", watermark: "created_at" },
  { name: "bot_reseller_balance_transactions", watermark: "created_at" },
];

const BATCH = 1000;

async function ensureWatermarkRows(sb: any) {
  for (const t of TABLES) {
    await sb
      .from("sync_watermarks")
      .upsert(
        { table_name: t.name, watermark_column: t.watermark },
        { onConflict: "table_name", ignoreDuplicates: true },
      );
  }
}

async function fetchOldChanges(table: string, col: string, since: string) {
  // Paginate until exhausted or 5k rows for safety per run.
  const all: any[] = [];
  let cursor = since;
  for (let i = 0; i < 5; i++) {
    const url =
      `${OLD_URL}/rest/v1/${table}?select=*&${col}=gt.${
        encodeURIComponent(cursor)
      }&order=${col}.asc&limit=${BATCH}`;
    const r = await fetch(url, {
      headers: {
        apikey: OLD_KEY,
        Authorization: `Bearer ${OLD_KEY}`,
        "Accept-Profile": "public",
      },
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Old fetch ${table} ${r.status}: ${body.slice(0, 300)}`);
    }
    const rows = await r.json();
    if (!rows.length) break;
    all.push(...rows);
    cursor = rows[rows.length - 1][col];
    if (rows.length < BATCH) break;
  }
  return all;
}

async function upsertIntoNew(sb: any, table: string, rows: any[]) {
  // Chunk to avoid request size limits
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from(table).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`Upsert ${table}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = createClient(NEW_URL, NEW_KEY, {
    auth: { persistSession: false },
  });

  try {
    await ensureWatermarkRows(sb);

    const { data: marks, error: mErr } = await sb
      .from("sync_watermarks")
      .select("*");
    if (mErr) throw mErr;

    const summary: Record<string, { synced: number; new_watermark?: string; error?: string }> = {};
    const byTable = new Map<string, any>(marks!.map((m: any) => [m.table_name, m]));

    for (const t of TABLES) {
      const mark = byTable.get(t.name);
      const since = mark?.last_value || "1970-01-01T00:00:00Z";
      try {
        const rows = await fetchOldChanges(t.name, t.watermark, since);
        if (rows.length) {
          await upsertIntoNew(sb, t.name, rows);
          const newMark = rows[rows.length - 1][t.watermark];
          await sb
            .from("sync_watermarks")
            .update({
              last_value: newMark,
              last_run_at: new Date().toISOString(),
              last_status: "ok",
              last_error: null,
              rows_synced_total: (mark?.rows_synced_total || 0) + rows.length,
              updated_at: new Date().toISOString(),
            })
            .eq("table_name", t.name);
          summary[t.name] = { synced: rows.length, new_watermark: newMark };
        } else {
          await sb
            .from("sync_watermarks")
            .update({
              last_run_at: new Date().toISOString(),
              last_status: "ok",
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("table_name", t.name);
          summary[t.name] = { synced: 0 };
        }
      } catch (e) {
        const msg = (e as Error).message;
        await sb
          .from("sync_watermarks")
          .update({
            last_run_at: new Date().toISOString(),
            last_status: "error",
            last_error: msg.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("table_name", t.name);
        summary[t.name] = { synced: 0, error: msg.slice(0, 200) };
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
