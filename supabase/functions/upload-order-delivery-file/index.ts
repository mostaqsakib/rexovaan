// Uploads an order delivery items .txt file to the public site-assets bucket
// and returns a public URL. Used by web Checkout when an order has many items
// (so the email links to the file instead of inlining the list).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { orderId, content, filename } = await req.json();
    if (!orderId || typeof orderId !== 'string' || typeof content !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (content.length > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Content too large' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Verify the order belongs to this auth user
    const { data: order, error: orderErr } = await admin
      .from('bot_orders')
      .select('id, customer:bot_customers!inner(auth_user_id)')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr || !order || (order as any).customer?.auth_user_id !== authUserId) {
      return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const safeName = (filename && typeof filename === 'string' ? filename : `order-${orderId}.txt`)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    const path = `order-deliveries/${orderId}/${safeName}`;

    const { error: uploadErr } = await admin.storage
      .from('site-assets')
      .upload(path, new Blob([content], { type: 'text/plain; charset=utf-8' }), {
        upsert: true,
        contentType: 'text/plain; charset=utf-8',
      });
    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: pub } = admin.storage.from('site-assets').getPublicUrl(path);
    return new Response(JSON.stringify({ url: pub.publicUrl, filename: safeName }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
