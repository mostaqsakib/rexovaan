// Customer checkout — feature-flagged:
//   bot_settings.use_atomic_checkout = 'true'  → new atomic single-RPC path (shadow rollout)
//   anything else (default 'false')           → legacy multi-step path (current production)
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

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return jsonRes({ error: 'Unauthorized' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonRes({ error: 'Unauthorized' }, 401);
    const authUserId = userData.user.id;

    const { productId, quantity, paymentMethod, idempotencyKey, expectedUnit } = await req.json();
    if (!productId || !quantity || quantity < 1 || quantity > 500) return jsonRes({ error: 'Invalid input' }, 400);
    if (paymentMethod !== 'balance') return jsonRes({ error: 'Please use Telegram bot for non-balance payments' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Customer
    const { data: customer } = await admin.from('bot_customers').select('*').eq('auth_user_id', authUserId).maybeSingle();
    if (!customer) return jsonRes({ error: 'Customer not found' }, 404);
    if (customer.is_banned) return jsonRes({ error: 'Account banned' }, 403);

    // Feature flag from bot_settings (DB-driven; admin can toggle without redeploy)
    const { data: flagRow } = await admin.from('bot_settings').select('value').eq('key', 'use_atomic_checkout').maybeSingle();
    const useAtomic = String(flagRow?.value ?? 'false').toLowerCase() === 'true';

    // -------------------- NEW ATOMIC PATH --------------------
    if (useAtomic) {
      if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
        return jsonRes({ error: 'Missing idempotency key' }, 400);
      }
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
        return jsonRes({ error: msg }, status);
      }
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!row?.order_id) return jsonRes({ error: 'Checkout returned no order' }, 500);

      const { data: product } = await admin.from('bot_products').select('name, custom_emoji_id').eq('id', productId).maybeSingle();
      if (product) {
        const p = notifyWebSale(admin, product, quantity).catch((e) => console.error('[WebSalesFeed]', e?.message || e));
        // @ts-ignore
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
      }
      return jsonRes({
        orderId: row.order_id,
        details: row.details,
        totalPrice: Number(row.total_price),
        unitPrice: Number(row.unit_price),
        newBalance: Number(row.new_balance),
        path: 'atomic',
      });
    }

    // -------------------- LEGACY MULTI-STEP PATH --------------------
    const { data: product } = await admin.from('bot_products').select('*').eq('id', productId).maybeSingle();
    if (!product || !product.is_active) return jsonRes({ error: 'Product not available' }, 400);
    if (product.is_manual_delivery) return jsonRes({ error: 'Manual delivery — please use Telegram bot' }, 400);

    let unitPrice = Number(product.price);
    const { data: special } = await admin.from('bot_customer_pricing').select('*')
      .eq('customer_id', customer.id).eq('product_id', productId).eq('is_active', true)
      .lte('min_quantity', quantity).order('min_quantity', { ascending: false }).limit(1).maybeSingle();
    const { data: tier } = await admin.from('bot_product_pricing').select('*')
      .eq('product_id', productId).lte('min_quantity', quantity)
      .order('min_quantity', { ascending: false }).limit(1).maybeSingle();
    const { data: flash } = await admin.from('bot_flash_sales').select('*')
      .eq('product_id', productId).eq('is_active', true).gte('ends_at', new Date().toISOString())
      .order('sale_price', { ascending: true }).limit(1).maybeSingle();
    const candidates: number[] = [unitPrice];
    if (tier) candidates.push(Number(tier.price));
    if (special) candidates.push(Number(special.price));
    if (flash) candidates.push(Number(flash.sale_price));
    unitPrice = Math.min(...candidates.filter((v) => Number.isFinite(v) && v > 0));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return jsonRes({ error: 'Product is not purchasable' }, 400);

    const totalPrice = +(unitPrice * quantity).toFixed(2);
    if (Number(customer.balance) < totalPrice) return jsonRes({ error: 'Insufficient balance' }, 400);

    const { data: orderRow, error: orderErr } = await admin.from('bot_orders').insert({
      customer_id: customer.id, product_id: productId, product_name: product.name,
      quantity, total_price: totalPrice, payment_method: 'balance', status: 'completed',
      details: [], row_numbers: [], source: 'web',
      idempotency_key: idempotencyKey || null,
    }).select('*').single();
    if (orderErr || !orderRow) throw orderErr || new Error('order insert failed');

    const { data: items, error: stockErr } = await admin.rpc('reserve_internal_stock_items', {
      _product_id: productId, _quantity: quantity, _order_id: orderRow.id,
    });
    if (stockErr) {
      await admin.from('bot_orders').delete().eq('id', orderRow.id);
      return jsonRes({ error: 'Not enough stock' }, 400);
    }
    const details = (items || []).map((i: any) => i.data);

    const { data: ded, error: dedErr } = await admin.rpc('deduct_customer_balance', { _customer_id: customer.id, _amount: totalPrice });
    if (dedErr || !ded?.[0]?.success) {
      await admin.rpc('restore_internal_stock_items', { _order_id: orderRow.id });
      await admin.from('bot_orders').delete().eq('id', orderRow.id);
      return jsonRes({ error: 'Balance deduction failed' }, 400);
    }

    await admin.from('bot_orders').update({ details, delivered_at: new Date().toISOString() }).eq('id', orderRow.id);

    const p = notifyWebSale(admin, product, quantity).catch((e) => console.error('[WebSalesFeed]', e?.message || e));
    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);

    return jsonRes({ orderId: orderRow.id, details, totalPrice, unitPrice, path: 'legacy' });
  } catch (e) {
    return jsonRes({ error: String((e as Error).message || e) }, 500);
  }
});
