// Bind a real Telegram account to the currently logged-in web user.
// Supports two modes:
//   action='widget'        -> verify Telegram Login Widget payload, then bind
//   action='generate_code' -> issue a short code; user pastes /bind <code> in the bot
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha256(msg: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg)));
}
async function hmacSha256(keyBytes: Uint8Array, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
function toHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
function genCode(): string {
  // 6-char uppercase alphanumeric, no confusing chars
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes).map(b => alphabet[b % alphabet.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'widget');
    const admin = createClient(url, serviceKey);

    if (action === 'generate_code') {
      // Clean up any old unused codes for this user
      await admin.from('bot_telegram_bind_codes').delete().eq('auth_user_id', uid).is('used_at', null);
      // Issue a fresh code (retry on rare collision)
      let code = '';
      for (let i = 0; i < 5; i++) {
        const candidate = genCode();
        const { error: insErr } = await admin.from('bot_telegram_bind_codes').insert({ code: candidate, auth_user_id: uid });
        if (!insErr) { code = candidate; break; }
      }
      if (!code) return json({ error: 'Could not generate code, try again' }, 500);
      return json({ ok: true, code, expires_in_seconds: 600 });
    }

    if (action === 'widget') {
      const widget = body?.widget;
      if (!widget || !widget.hash || !widget.id) return json({ error: 'Invalid Telegram payload' }, 400);

      const botToken = Deno.env.get('BOT_TOKEN');
      if (!botToken) return json({ error: 'Bot token missing' }, 500);

      const { hash, ...fields } = widget;
      const dataCheck = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
      const secret = await sha256(botToken);
      const calc = await hmacSha256(secret, dataCheck);
      if (toHex(calc) !== String(hash).toLowerCase()) return json({ error: 'Invalid Telegram signature' }, 401);

      const authDate = Number(fields.auth_date || 0);
      if (!authDate || (Date.now() / 1000 - authDate) > 86400) return json({ error: 'Telegram login expired, try again' }, 401);

      const chatId = Number(fields.id);
      const { data: result, error: rpcErr } = await admin.rpc('bind_telegram_to_customer', {
        _auth_user_id: uid,
        _chat_id: chatId,
        _username: fields.username || null,
        _first_name: fields.first_name || null,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 500);
      const row = Array.isArray(result) ? result[0] : result;
      if (row?.status === 'conflict') return json({ error: row.message || 'Telegram already linked elsewhere' }, 409);
      return json({ ok: true, status: row?.status || 'ok' });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
