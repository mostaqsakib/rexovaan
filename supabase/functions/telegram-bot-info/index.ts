// Public endpoint returning bot username for Telegram Login Widget
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const username = (Deno.env.get('BOT_USERNAME') || '').replace(/^@/, '');
  return new Response(JSON.stringify({ bot_username: username }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
