// Admin-only: cancel a pending-delivery order and refund the customer atomically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAdmin } from '../_shared/require-admin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const guard = await requireAdmin(req, corsHeaders);
  if (guard) return guard;

  try {
    const { order_id } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Atomic claim — only first caller transitions out of pending_delivery.
    const { data: order, error: updErr } = await admin
      .from('bot_orders')
      .update({ status: 'cancelled' })
      .eq('id', order_id)
      .eq('status', 'pending_delivery')
      .select('id, customer_id, total_price, payment_method, product_name, quantity')
      .maybeSingle();
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not in pending_delivery state' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isPayLater = String(order.payment_method || '').toLowerCase() === 'pay later';
    const rpc = isPayLater ? 'refund_pay_later_credit' : 'refund_customer_balance';
    if (order.customer_id) {
      const { error: refundErr } = await admin.rpc(rpc as any, {
        _customer_id: order.customer_id,
        _amount: Number(order.total_price || 0),
      });
      if (refundErr) {
        console.error('refund RPC failed', refundErr);
        return new Response(JSON.stringify({ error: `Refund failed: ${refundErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ ok: true, order }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
