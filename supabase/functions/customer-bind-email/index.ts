// Bind / update a real email + password for the currently logged-in customer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email' }, 400);
    if (email.endsWith('@telegram.local')) return json({ error: 'Reserved email domain' }, 400);
    if (!password || password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const admin = createClient(url, serviceKey);

    // Ensure email is not already used by another auth user
    const { data: list } = await admin.auth.admin.listUsers();
    const conflict = list?.users.find((u) => u.email?.toLowerCase() === email && u.id !== uid);
    if (conflict) return json({ error: 'Email already in use' }, 409);

    const { error: updErr } = await admin.auth.admin.updateUserById(uid, {
      email,
      password,
      email_confirm: true,
    });
    if (updErr) return json({ error: updErr.message }, 400);

    return json({ ok: true, email });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
