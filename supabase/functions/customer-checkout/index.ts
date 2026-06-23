// Customer checkout: atomic single-RPC checkout (order + stock + balance in one transaction)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function applyTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

async function notifyWebSale(admin: any, product: any, qty: number) {
  const { data: settings } = await admin
    .from('bot_settings')
    .select('key, value')
    .in('key', ['recent_sales_group_id_web', 'recent_sales_group_id', 'msg_recent_sale_web']);
  const map: Record<string, string> = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
  const rawId = (map.recent_sales_group_id_web && map.recent_sales_group_id_web !== '')
    ? map.recent_sales_group_id_web
    : (map.recent_sales_group_id && map.recent_sales_group_id !== '' ? map.recent_sales_group_id : null);
  const groupId = rawId ? Number(rawId) : null;
  if (!groupId) return;

  const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
  if (!BOT_TOKEN) return;

  const icon = product.custom_emoji_id
    ? `<tg-emoji emoji-id="${product.custom_emoji_id}">📦</tg-emoji>`
    : '🛍️';
  const vars = {
    product: `${icon} <b>${escapeHtml(product.name)}</b>`,
    quantity: String(qty),
  };
  const tpl = map.msg_recent_sale_web || `🛍️ Someone just bought <b>{quantity}× {product}</b> from the website`;
  const text = applyTemplate(tpl, vars);

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: groupId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error('notifyWebSale failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const authUserId = userData.user.id;

    const { productId, quantity, paymentMethod, idempotencyKey, expectedUnit } = await req.json();
    if (!productId || !quantity || quantity < 1 || quantity > 500) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
      return new Response(JSON.stringify({ error: 'Missing idempotency key' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (paymentMethod !== 'balance') {
      return new Response(JSON.stringify({ error: 'Please use Telegram bot for non-balance payments' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Look up customer (auth → customer mapping)
    const { data: customer } = await admin
      .from('bot_customers')
      .select('id, is_banned')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (!customer) return new Response(JSON.stringify({ error: 'Customer not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (customer.is_banned) return new Response(JSON.stringify({ error: 'Account banned' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Single atomic RPC: order + stock + balance debit + idempotency, all in one transaction
    const { data: rpcData, error: rpcErr } = await admin.rpc('checkout_balance_atomic', {
      _customer_id: customer.id,
      _product_id: productId,
      _quantity: quantity,
      _expected_unit: Number(expectedUnit) || 0,
      _idempotency_key: idempotencyKey,
    });
    if (rpcErr) {
      const msg = String(rpcErr.message || 'Checkout failed');
      const status = /not.*available|banned|insufficient|not.*purchasable|price.*changed|not enough stock|invalid|missing/i.test(msg) ? 400 : 500;
      return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row?.order_id) {
      return new Response(JSON.stringify({ error: 'Checkout returned no order' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Best-effort: fetch product for sales-feed notify (skip on duplicate idempotent replay? still ok)
    const { data: product } = await admin.from('bot_products').select('name, custom_emoji_id').eq('id', productId).maybeSingle();

    if (product) {
      const notifyPromise = notifyWebSale(admin, product, quantity)
        .catch((e) => console.error('[WebSalesFeed]', e?.message || e));
      // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(notifyPromise);
      }
    }

    return new Response(
      JSON.stringify({
        orderId: row.order_id,
        details: row.details,
        totalPrice: Number(row.total_price),
        unitPrice: Number(row.unit_price),
        newBalance: Number(row.new_balance),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
