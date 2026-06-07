// Sync ALL data from OLD Supabase project to NEW Supabase project.
// Cron triggers this every ~10 seconds via staggered pg_cron jobs.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const OLD_URL = Deno.env.get('OLD_SUPABASE_URL')!;
const OLD_KEY = Deno.env.get('OLD_SUPABASE_SERVICE_ROLE_KEY')!;
const NEW_URL = Deno.env.get('NEW_SUPABASE_URL')!;
const NEW_KEY = Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY')!;

async function fetchAll(table: string, query = ''): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const u = `${OLD_URL}/rest/v1/${table}?select=*${query ? '&' + query : ''}`;
    const res = await fetch(u, {
      headers: {
        apikey: OLD_KEY,
        Authorization: `Bearer ${OLD_KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`fetch ${table} ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function upsert(table: string, rows: any[], conflict = 'id'): Promise<number> {
  if (!rows.length) return 0;
  const chunk = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const res = await fetch(`${NEW_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        apikey: NEW_KEY,
        Authorization: `Bearer ${NEW_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(part),
    });
    if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${await res.text()}`);
    total += part.length;
  }
  return total;
}

type Job = { table: string; query?: string; conflict?: string };

async function runOnce(fullStock = false) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const stockJob: Job = fullStock
    ? { table: 'bot_product_stock_items' }
    : {
        table: 'bot_product_stock_items',
        query: `or=(created_at.gte.${since},updated_at.gte.${since},sold_at.gte.${since})`,
      };

  const jobs: Job[] = [
    // Core / customer
    { table: 'bot_customers' },
    { table: 'bot_customer_pricing' },
    { table: 'bot_notification_settings' },
    { table: 'bot_balance_adjustments' },
    { table: 'bot_deposits' },
    { table: 'bot_withdrawals' },

    // Products
    { table: 'bot_products' },
    { table: 'bot_product_pricing' },
    { table: 'bot_product_sources' },
    stockJob,

    // Orders
    { table: 'bot_orders' },
    { table: 'bot_reseller_orders' },

    // Resellers
    { table: 'bot_resellers' },
    { table: 'bot_reseller_balance_transactions' },

    // Referrals
    { table: 'bot_referrals' },
    { table: 'bot_referral_earnings' },

    // Bot config / misc
    { table: 'bot_settings' },
    { table: 'bot_payment_methods' },
    { table: 'bot_flash_sales' },
    { table: 'bot_broadcast_groups' },
    { table: 'bot_keyword_triggers' },
    { table: 'bot_button_emojis', conflict: 'button_key' },
    { table: 'bot_custom_emoji_cache', conflict: 'emoji_id' },
    { table: 'telegram_bot_state' },

    // Site / announcements
    { table: 'site_announcements' },
    { table: 'customer_announcement_reads' },

    // Auth / roles
    { table: 'user_roles', conflict: 'user_id,role' },

    // Email
    { table: 'email_send_state' },
    { table: 'email_send_log' },
    { table: 'email_unsubscribe_tokens' },
    { table: 'suppressed_emails' },
  ];


  const results: any[] = [];
  const errors: any[] = [];
  for (const j of jobs) {
    try {
      const rows = await fetchAll(j.table, j.query);
      const written = await upsert(j.table, rows, j.conflict ?? 'id');
      results.push({ table: j.table, fetched: rows.length, written });
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
    return new Response(
      JSON.stringify({ ok: !hasErrors, duration_ms: Date.now() - started, ...result }),
      {
        status: hasErrors ? 207 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, duration_ms: Date.now() - started, error: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
