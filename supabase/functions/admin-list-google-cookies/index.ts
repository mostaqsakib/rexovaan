// Admin-only: list google_account_cookies metadata (never returns raw cookie payload).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAdmin } from '../_shared/require-admin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const guard = await requireAdmin(req, corsHeaders);
  if (guard) return guard;

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // Only return safe metadata — never the raw cookie JSON.
    const { data, error } = await admin
      .from('google_account_cookies')
      .select('id, label, is_active, expired, last_verified_at, created_at')
      .order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ cookies: data ?? [] });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
