// Admin helper: returns emails for given auth_user_ids, and/or searches auth users by email substring.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.auth_user_ids) ? body.auth_user_ids.filter((x: unknown) => typeof x === 'string') : [];
    const searchEmail: string = typeof body?.search_email === 'string' ? body.search_email.trim().toLowerCase() : '';

    if (ids.length === 0 && !searchEmail) return json({ emails: {}, matched_ids: [] });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const emails: Record<string, string> = {};
    const matchedIds: string[] = [];
    const wanted = new Set(ids);
    const needSearch = !!searchEmail;

    let page = 1;
    const perPage = 1000;
    while ((wanted.size > 0 || needSearch) && page <= 20) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      for (const u of data?.users || []) {
        const em = u.email?.toLowerCase() || '';
        if (!em || em.endsWith('@telegram.local')) continue;
        if (wanted.has(u.id)) {
          emails[u.id] = u.email!;
          wanted.delete(u.id);
        }
        if (needSearch && em.includes(searchEmail)) {
          matchedIds.push(u.id);
          emails[u.id] = u.email!;
        }
      }
      if (!data?.users || data.users.length < perPage) break;
      page++;
    }
    return json({ emails, matched_ids: matchedIds });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
