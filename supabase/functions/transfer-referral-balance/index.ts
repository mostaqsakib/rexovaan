// Atomically transfer referral_balance → main balance for the authenticated customer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: me } = await admin
      .from('bot_customers')
      .select('id, balance, referral_balance, referral_transferred, is_banned')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();
    if (!me) return json({ error: 'Customer not found' }, 404);
    if (me.is_banned) return json({ error: 'Account banned' }, 403);

    const refBal = Number(me.referral_balance) || 0;
    if (refBal <= 0) return json({ error: 'No referral balance to transfer' }, 400);

    const newBal = +(Number(me.balance) + refBal).toFixed(4);
    const newTransferred = +(Number(me.referral_transferred || 0) + refBal).toFixed(4);

    // Optimistic guard: only update if referral_balance is still refBal
    const { data: upd, error: updErr } = await admin
      .from('bot_customers')
      .update({
        balance: newBal,
        referral_balance: 0,
        referral_transferred: newTransferred,
        updated_at: new Date().toISOString(),
      })
      .eq('id', me.id)
      .eq('referral_balance', me.referral_balance)
      .select('id, balance, referral_balance, referral_transferred')
      .maybeSingle();

    if (updErr) return json({ error: updErr.message }, 500);
    if (!upd) return json({ error: 'Balance changed, please retry' }, 409);

    return json({
      ok: true,
      transferred: refBal,
      new_balance: Number(upd.balance),
      new_referral_balance: Number(upd.referral_balance),
    });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
