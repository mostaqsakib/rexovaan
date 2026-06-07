-- Enable extensions for cron + HTTP
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior schedule with the same name (safe re-run)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-from-old-every-minute') then
    perform cron.unschedule('sync-from-old-every-minute');
  end if;
end
$$;

-- Run every minute: call the sync-from-old edge function
select cron.schedule(
  'sync-from-old-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://eygkdpfjrjwwbiackfpr.supabase.co/functions/v1/sync-from-old',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z2tkcGZqcmp3d2JpYWNrZnByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjkyMzEsImV4cCI6MjA5NjE0NTIzMX0.KQQkvoNmrXROOEHzSsePcyvpDEmbrueNEmtnvJlZ-dU',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z2tkcGZqcmp3d2JpYWNrZnByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjkyMzEsImV4cCI6MjA5NjE0NTIzMX0.KQQkvoNmrXROOEHzSsePcyvpDEmbrueNEmtnvJlZ-dU'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    ) as request_id;
  $$
);
