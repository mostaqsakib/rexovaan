// Customer-facing: returns a short-lived signed URL for a file stock item attached to an order they own.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);

    const { order_id, item_index } = await req.json();
    if (!order_id || typeof item_index !== 'number') return json({ error: 'Invalid input' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: order, error: orderErr } = await admin
      .from('bot_orders')
      .select('id, details, customer_id, bot_customers!inner(auth_user_id)')
      .eq('id', order_id)
      .single();
    if (orderErr || !order) return json({ error: 'Order not found' }, 404);
    // @ts-ignore nested
    if (order.bot_customers?.auth_user_id !== userData.user.id) return json({ error: 'Forbidden' }, 403);

    const details = Array.isArray(order.details) ? order.details : [];
    const item = details[item_index] as Record<string, any> | undefined;
    const filePath = item?._file_path;
    if (!filePath) return json({ error: 'No file for this item' }, 404);

    const { data: signed, error: signErr } = await admin.storage
      .from('product-files')
      .createSignedUrl(filePath, 300, { download: item._file_name || true });
    if (signErr || !signed) return json({ error: signErr?.message || 'Failed to sign' }, 500);

    return json({ url: signed.signedUrl, file_name: item._file_name, expires_in: 300 });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
