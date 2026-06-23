// Verify Telegram Login Widget callback, upsert customer, return magic action link
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { timingSafeEqual } from '../_shared/timing-safe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256(msg: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return new Uint8Array(buf);
}

async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

function toHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const payload = await req.json();
    const { hash, ...fields } = payload || {};
    if (!hash || !fields.id) {
      return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const botToken = Deno.env.get('BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_API_KEY_1') || Deno.env.get('TELEGRAM_API_KEY');
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'bot token missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build data_check_string: sort keys alphabetically, key=value joined by \n
    const dataCheck = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
    const secret = await sha256(botToken);
    const calc = await hmacSha256(secret, dataCheck);
    if (!timingSafeEqual(toHex(calc), String(hash).toLowerCase())) {
      return new Response(JSON.stringify({ error: 'invalid hash' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Reject stale (>1 day) auth
    const authDate = Number(fields.auth_date || 0);
    if (!authDate || (Date.now() / 1000 - authDate) > 86400) {
      return new Response(JSON.stringify({ error: 'expired' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const chatId = Number(fields.id);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: existing } = await supabase.from('bot_customers').select('*').eq('chat_id', chatId).maybeSingle();
    let customer = existing;
    if (!customer) {
      const ins = await supabase.from('bot_customers').insert({
        chat_id: chatId,
        username: fields.username || null,
        first_name: fields.first_name || null,
      }).select('*').single();
      customer = ins.data;
    }
    if (!customer) throw new Error('customer upsert failed');

    const syntheticEmail = `tg-${chatId}@telegram.local`;
    let authUserId = customer.auth_user_id as string | null;
    if (!authUserId) {
      const created = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { telegram_chat_id: chatId, username: fields.username, first_name: fields.first_name },
      });
      if (created.data?.user) {
        authUserId = created.data.user.id;
      } else {
        const list = await supabase.auth.admin.listUsers();
        const found = list.data?.users.find(u => u.email === syntheticEmail);
        authUserId = found?.id || null;
      }
      if (authUserId) {
        await supabase.from('bot_customers').update({ auth_user_id: authUserId }).eq('id', customer.id);
      }
    }
    if (!authUserId) throw new Error('auth user not created');

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
