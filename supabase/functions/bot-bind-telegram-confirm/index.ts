// Called by the Telegram bot when a user runs /bind <code>.
// Authentication: Authorization: Bearer <BOT_TOKEN>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { timingSafeEqual } from '../_shared/timing-safe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const botToken = Deno.env.get('BOT_TOKEN');
    if (!botToken) return json({ error: 'Bot token missing' }, 500);

    const auth = req.headers.get('Authorization') || '';
    const provided = auth.replace(/^Bearer\s+/i, '');
    if (!timingSafeEqual(provided, botToken)) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || '').trim().toUpperCase();
    const chatId = Number(body?.chat_id);
    const username = body?.username ? String(body.username) : null;
    const firstName = body?.first_name ? String(body.first_name) : null;

    if (!code || !/^[A-Z0-9]{4,16}$/.test(code)) return json({ error: 'Invalid code format' }, 400);
    if (!chatId || !Number.isFinite(chatId)) return json({ error: 'Invalid chat_id' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Anti-brute-force: lock chat for 1 hour after 10 failures.
    const { data: attempts } = await supabase
      .from('bot_bind_attempts')
      .select('fails, locked_until')
      .eq('chat_id', chatId)
      .maybeSingle();
    if (attempts?.locked_until && new Date(attempts.locked_until).getTime() > Date.now()) {
      return json({ error: 'Too many failed attempts. Try again later.' }, 429);
    }

    const recordFail = async () => {
      const fails = (attempts?.fails ?? 0) + 1;
      const lockedUntil = fails >= 10 ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
      await supabase.from('bot_bind_attempts').upsert({
        chat_id: chatId, fails, locked_until: lockedUntil, updated_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' });
    };

    const { data: codeRow, error: codeErr } = await supabase
      .from('bot_telegram_bind_codes')
      .select('auth_user_id, expires_at, used_at')
      .eq('code', code)
      .maybeSingle();
    if (codeErr) return json({ error: codeErr.message }, 500);
    if (!codeRow) { await recordFail(); return json({ error: 'Code not found' }, 404); }
    if (codeRow.used_at) { await recordFail(); return json({ error: 'Code already used' }, 410); }
    if (new Date(codeRow.expires_at).getTime() < Date.now()) { await recordFail(); return json({ error: 'Code expired' }, 410); }

    const { data: result, error: rpcErr } = await supabase.rpc('bind_telegram_to_customer', {
      _auth_user_id: codeRow.auth_user_id,
      _chat_id: chatId,
      _username: username,
      _first_name: firstName,
    });
    if (rpcErr) return json({ error: rpcErr.message }, 500);
    const row = Array.isArray(result) ? result[0] : result;
    if (row?.status === 'conflict') return json({ error: row.message || 'Telegram already linked elsewhere' }, 409);

    await supabase.from('bot_telegram_bind_codes').update({ used_at: new Date().toISOString() }).eq('code', code);
    // Clear failure counter on success.
    await supabase.from('bot_bind_attempts').delete().eq('chat_id', chatId);
    return json({ ok: true, status: row?.status || 'ok' });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
