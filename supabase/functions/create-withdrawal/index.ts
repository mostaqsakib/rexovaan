// Atomic create-withdrawal endpoint.
// Replaces the legacy 2-step client flow (insert + deduct) so a network drop
// cannot leave a pending withdrawal without a matching balance deduction.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BodySchema = z.object({
  amount: z.number().positive().max(100000),
  payment_details: z.string().trim().min(4).max(500),
  network: z.string().trim().min(2).max(32).default('TRC20'),
  asset: z.string().trim().min(2).max(16).default('USDT'),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);
    const authUserId = userData.user.id;

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
    const { amount, payment_details, network, asset } = parsed.data;

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: customer, error: custErr } = await admin
      .from('bot_customers')
      .select('id, balance, is_banned')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (custErr) return json({ error: custErr.message }, 500);
    if (!customer) return json({ error: 'Customer not found' }, 404);
    if (customer.is_banned) return json({ error: 'Account is banned' }, 403);

    const { data: rpcRows, error: rpcErr } = await admin.rpc('create_withdrawal_atomic', {
      _customer_id: customer.id,
      _amount: amount,
      _payment_details: payment_details,
      _network: network,
      _asset: asset,
    });
    if (rpcErr) {
      const msg = rpcErr.message || 'Withdrawal failed';
      const status = /Insufficient balance|banned|not found|greater than/i.test(msg) ? 400 : 500;
      return json({ error: msg }, status);
    }
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    return json({ ok: true, withdrawal_id: row?.withdrawal_id, new_balance: Number(row?.new_balance ?? 0) });
  } catch (e) {
    console.error('create-withdrawal error', e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
