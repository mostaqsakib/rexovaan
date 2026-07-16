// Apply a referral code to the currently authenticated customer.
// Mirrors bot's /start ref_<code> flow (md5(chat_id).slice(0,8)).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHash } from 'node:crypto';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function refCode(chatId: number | string): string {
  return createHash('md5').update(String(chatId)).digest('hex').slice(0, 8).toLowerCase();
}

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

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').toLowerCase().trim();
    if (!/^[a-f0-9]{8}$/.test(code)) return json({ error: 'Invalid code' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: me } = await admin.from('bot_customers').select('id').eq('auth_user_id', userData.user.id).maybeSingle();
    if (!me) return json({ error: 'Customer not found' }, 404);

    // Already referred?
    const { data: existing } = await admin.from('bot_referrals').select('id').eq('referred_id', me.id).maybeSingle();
    if (existing) return json({ ok: true, already: true });

    // Find referrer by code (paginate to bypass 1000-row limit)
    let referrerId: string | null = null;
    let referrerChatId: number | null = null;
    const pageSize = 1000;
    for (let from = 0; from < 200000; from += pageSize) {
      const { data: page, error } = await admin
        .from('bot_customers')
        .select('id, chat_id')
        .not('chat_id', 'is', null)
        .range(from, from + pageSize - 1);
      if (error) return json({ error: error.message }, 500);
      if (!page || page.length === 0) break;
      for (const c of page) {
        if (c.id === me.id) continue;
        if (refCode(c.chat_id!) === code) {
          referrerId = c.id;
          referrerChatId = c.chat_id as number;
          break;
        }
      }
      if (referrerId) break;
      if (page.length < pageSize) break;
    }

    if (!referrerId) return json({ error: 'Referrer not found' }, 404);

    const { error: insErr } = await admin.from('bot_referrals').insert({ referrer_id: referrerId, referred_id: me.id });
    if (insErr) {
      // Race: another process may have inserted concurrently
      if (String(insErr.message).toLowerCase().includes('duplicate')) return json({ ok: true, already: true });
      return json({ error: insErr.message }, 500);
    }

    // Optional: notify referrer if campaign is active (DB trigger handles crediting)
    if (referrerChatId && referrerChatId > 0) {
      const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
      if (BOT_TOKEN) {
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: referrerChatId,
            text: '🎉 <b>New Referral!</b>\n\nA new user just signed up via your referral link on the website.',
            parse_mode: 'HTML',
          }),
        }).catch(() => {});
      }
    }

    return json({ ok: true, referrer_id: referrerId });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
