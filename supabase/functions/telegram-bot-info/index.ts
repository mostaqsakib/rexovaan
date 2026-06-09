// Public endpoint returning bot username for Telegram Login Widget
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getBotUsername() {
  const configured = (Deno.env.get('BOT_USERNAME') || Deno.env.get('TELEGRAM_BOT_USERNAME') || '').replace(/^@/, '').trim();
  if (configured) return configured;

  const token = Deno.env.get('BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_API_KEY_1') || Deno.env.get('TELEGRAM_API_KEY');
  if (!token) return '';

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => null);
  return data?.ok && data?.result?.username ? String(data.result.username).replace(/^@/, '') : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const username = await getBotUsername();
  return new Response(JSON.stringify({ bot_username: username }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
