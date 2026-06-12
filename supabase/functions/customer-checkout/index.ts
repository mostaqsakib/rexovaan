// Customer checkout: validates price, reserves stock, creates order
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
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const authUserId = claims.claims.sub;

    const { productId, quantity, paymentMethod } = await req.json();
    if (!productId || !quantity || quantity < 1 || quantity > 500) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Customer
    const { data: customer } = await admin.from('bot_customers').select('*').eq('auth_user_id', authUserId).maybeSingle();
    if (!customer) return new Response(JSON.stringify({ error: 'Customer not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (customer.is_banned) return new Response(JSON.stringify({ error: 'Account banned' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Product
    const { data: product } = await admin.from('bot_products').select('*').eq('id', productId).maybeSingle();
    if (!product || !product.is_active) return new Response(JSON.stringify({ error: 'Product not available' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (product.is_manual_delivery) return new Response(JSON.stringify({ error: 'Manual delivery — please use Telegram bot' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Resolve unit price: special > flash (if cheaper) > tiered > base
    let unitPrice = Number(product.price);
    const { data: special } = await admin
      .from('bot_customer_pricing')
      .select('*')
      .eq('customer_id', customer.id)
      .eq('product_id', productId)
      .eq('is_active', true)
      .lte('min_quantity', quantity)
      .order('min_quantity', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (special) unitPrice = Number(special.price);
    else {
      const { data: tier } = await admin
        .from('bot_product_pricing')
        .select('*')
        .eq('product_id', productId)
        .lte('min_quantity', quantity)
        .order('min_quantity', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tier) unitPrice = Number(tier.price);
    }
    const { data: flash } = await admin
      .from('bot_flash_sales')
      .select('*')
      .eq('product_id', productId)
      .eq('is_active', true)
      .gte('ends_at', new Date().toISOString())
      .order('sale_price', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (flash && Number(flash.sale_price) < unitPrice) unitPrice = Number(flash.sale_price);

    const totalPrice = +(unitPrice * quantity).toFixed(2);

    // Only "balance" supported here. Other methods go through bot for now.
    if (paymentMethod !== 'balance') {
      return new Response(JSON.stringify({ error: 'Please use Telegram bot for non-balance payments' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (Number(customer.balance) < totalPrice) {
      return new Response(JSON.stringify({ error: 'Insufficient balance' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Create order shell
    const { data: orderRow, error: orderErr } = await admin.from('bot_orders').insert({
      customer_id: customer.id,
      product_id: productId,
      product_name: product.name,
      quantity,
      total_price: totalPrice,
      payment_method: 'balance',
      status: 'completed',
      details: [],
      row_numbers: [],
      source: 'web',
    }).select('*').single();
    if (orderErr || !orderRow) throw orderErr || new Error('order insert failed');

    // Reserve stock
    const { data: items, error: stockErr } = await admin.rpc('reserve_internal_stock_items', {
      _product_id: productId,
      _quantity: quantity,
      _order_id: orderRow.id,
    });
    if (stockErr) {
      await admin.from('bot_orders').delete().eq('id', orderRow.id);
      return new Response(JSON.stringify({ error: 'Not enough stock' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const details = (items || []).map((i: any) => i.data);

    // Deduct balance
    const { data: ded, error: dedErr } = await admin.rpc('deduct_customer_balance', { _customer_id: customer.id, _amount: totalPrice });
    if (dedErr || !ded?.[0]?.success) {
      await admin.rpc('restore_internal_stock_items', { _order_id: orderRow.id });
      await admin.from('bot_orders').delete().eq('id', orderRow.id);
      return new Response(JSON.stringify({ error: 'Balance deduction failed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await admin.from('bot_orders').update({ details, delivered_at: new Date().toISOString() }).eq('id', orderRow.id);

    // Background task: notify Web Sales Feed group (anonymous).
    // Must use EdgeRuntime.waitUntil — bare promises get killed when the isolate
    // shuts down right after the response is sent (EarlyDrop).
    const notifyPromise = notifyWebSale(admin, product, quantity)
      .catch((e) => console.error('[WebSalesFeed]', e?.message || e));
    // @ts-ignore - EdgeRuntime is provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(notifyPromise);
    } else {
      await notifyPromise;
    }

    return new Response(JSON.stringify({ orderId: orderRow.id, details, totalPrice, unitPrice }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
