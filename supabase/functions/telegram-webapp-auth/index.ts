// Verify Telegram WebApp initData, upsert customer, return a Supabase session
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { timingSafeEqual } from '../_shared/timing-safe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

function toHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function verifyInitData(initData: string, botToken: string): Promise<Record<string, string> | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const calc = await hmacSha256(secret, dataCheck);
  if (!timingSafeEqual(toHex(calc), hash)) return null;
  // Freshness: reject initData older than 1 day to block replay.
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || (Date.now() / 1000 - authDate) > 86400) return null;
  return Object.fromEntries(params.entries());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { initData } = await req.json();
    if (!initData) return new Response(JSON.stringify({ error: 'missing initData' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const botToken = Deno.env.get('BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_API_KEY_1') || Deno.env.get('TELEGRAM_API_KEY');
    if (!botToken) return new Response(JSON.stringify({ error: 'bot token missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const verified = await verifyInitData(initData, botToken);
    if (!verified) return new Response(JSON.stringify({ error: 'invalid initData' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const user = JSON.parse(verified.user || '{}');
    const chatId = user.id;
    if (!chatId) return new Response(JSON.stringify({ error: 'no user' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Find / create customer
    const { data: existing } = await supabase.from('bot_customers').select('*').eq('chat_id', chatId).maybeSingle();
    let customer = existing;
    if (!customer) {
      const ins = await supabase.from('bot_customers').insert({
        chat_id: chatId,
        username: user.username || null,
        first_name: user.first_name || null,
      }).select('*').single();
      customer = ins.data;
    }
    if (!customer) throw new Error('customer upsert failed');

    // Synthetic email so we can use email/password sign-in
    const syntheticEmail = `tg-${chatId}@telegram.local`;

    let authUserId = customer.auth_user_id as string | null;
    if (!authUserId) {
      // Try create
      const created = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { telegram_chat_id: chatId, username: user.username, first_name: user.first_name },
      });
      if (created.data?.user) {
        authUserId = created.data.user.id;
      } else {
        // Already exists, look up
        const list = await supabase.auth.admin.listUsers();
        const found = list.data?.users.find(u => u.email === syntheticEmail);
        authUserId = found?.id || null;
      }
      if (authUserId) {
        await supabase.from('bot_customers').update({ auth_user_id: authUserId }).eq('id', customer.id);
      }
    }
    if (!authUserId) throw new Error('auth user not created');

    // Use the user's CURRENT email (may have been bound to a real one)
    let loginEmail = syntheticEmail;
    try {
      const got = await supabase.auth.admin.getUserById(authUserId);
      if (got.data?.user?.email) loginEmail = got.data.user.email;
    } catch (_) { /* ignore */ }

    const link = await supabase.auth.admin.generateLink({ type: 'magiclink', email: loginEmail });
    const actionLink = (link.data as any)?.properties?.action_link;
    if (!actionLink) throw new Error('no action link');

    return new Response(JSON.stringify({ action_link: actionLink, email: loginEmail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
