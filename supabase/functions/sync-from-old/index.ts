// Sync data from OLD Supabase project to NEW Supabase project.
// Cron triggers this every ~10 seconds via staggered pg_cron jobs.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const OLD_URL = Deno.env.get('OLD_SUPABASE_URL')!;
const OLD_KEY = Deno.env.get('OLD_SUPABASE_SERVICE_ROLE_KEY')!;
const NEW_URL = Deno.env.get('NEW_SUPABASE_URL')!;
const NEW_KEY = Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY')!;

async function fetchAll(url: string, key: string, table: string, query = ''): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const u = `${url}/rest/v1/${table}?select=*${query ? '&' + query : ''}`;
    const res = await fetch(u, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`fetch ${table} failed ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function upsert(url: string, key: string, table: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  const chunk = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(part),
    });
    if (!res.ok) throw new Error(`upsert ${table} failed ${res.status}: ${await res.text()}`);
    total += part.length;
  }
  return total;
}

async function syncTable(table: string, query = '') {
  const rows = await fetchAll(OLD_URL, OLD_KEY, table, query);
  const written = await upsert(NEW_URL, NEW_KEY, table, rows);
  return { table, fetched: rows.length, written };
}

async function runOnce() {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const jobs: Array<{ table: string; query?: string }> = [
    { table: 'bot_customers' },
    { table: 'bot_products' },
    { table: 'bot_product_pricing' },
    { table: 'bot_product_sources' },
    { table: 'bot_reseller_orders' },
    {
      table: 'bot_product_stock_items',
      query: `or=(created_at.gte.${since},updated_at.gte.${since},sold_at.gte.${since})`,
    },
    { table: 'bot_orders' },
  ];
  const results: any[] = [];
  const errors: any[] = [];
  for (const j of jobs) {
    try {
      results.push(await syncTable(j.table, j.query));
    } catch (e) {
      errors.push({ table: j.table, error: String(e) });
    }
  }
  return { since, results, errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const started = Date.now();
  try {
    const result = await runOnce();
    const hasErrors = result.errors.length > 0;
    return new Response(JSON.stringify({ ok: !hasErrors, duration_ms: Date.now() - started, ...result }), {
      status: hasErrors ? 207 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, duration_ms: Date.now() - started, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
