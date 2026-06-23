import { createClient } from 'npm:@supabase/supabase-js@2'
import { timingSafeEqual } from '../_shared/timing-safe.ts'

Deno.serve(async (req) => {
  // Admin/operator-only endpoint. Requires CRON_SHARED_SECRET in the Authorization header.
  const expected = Deno.env.get('CRON_SHARED_SECRET')
  if (!expected) {
    return new Response(JSON.stringify({ error: 'Server not configured (CRON_SHARED_SECRET)' }), { status: 500 })
  }
  const auth = req.headers.get('Authorization') || ''
  const provided = auth.replace(/^Bearer\s+/i, '')
  if (!timingSafeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, serviceKey)

  const projectRef = url.replace('https://', '').split('.')[0]
  const fnUrl = `https://${projectRef}.supabase.co/functions/v1/process-email-queue`

  const sql = `
    do $$
    declare
      sid uuid;
    begin
      -- Upsert vault secret
      select id into sid from vault.secrets where name = 'email_queue_service_role_key';
      if sid is null then
        perform vault.create_secret(${quote(serviceKey)}, 'email_queue_service_role_key', 'Service role key for process-email-queue cron');
      else
        perform vault.update_secret(sid, ${quote(serviceKey)}, 'email_queue_service_role_key', 'Service role key for process-email-queue cron');
      end if;
    end$$;

    select cron.unschedule(jobid) from cron.job where jobname = 'process-email-queue';

    select cron.schedule(
      'process-email-queue',
      '5 seconds',
      $cron$
      select net.http_post(
        url := ${quote(fnUrl)},
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key' limit 1)
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  `

  // Use raw SQL via PostgREST RPC? Not available. Use pg HTTP? Use a created RPC.
  // Simpler: use supabase-js to call rpc that we already have... none for arbitrary SQL.
  // Instead, execute via Postgres connection using Deno postgres client.
  const { Client } = await import('https://deno.land/x/postgres@v0.19.3/mod.ts')
  const dbUrl = Deno.env.get('SUPABASE_DB_URL')
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: 'SUPABASE_DB_URL not available' }), { status: 500 })
  }
  const client = new Client(dbUrl)
  await client.connect()
  try {
    await client.queryArray(sql)
  } finally {
    await client.end()
  }

  return new Response(JSON.stringify({ ok: true, fnUrl }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function quote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'"
}
