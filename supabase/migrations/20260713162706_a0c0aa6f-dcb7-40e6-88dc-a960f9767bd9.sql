
SELECT cron.unschedule('bep20-sweep-every-2-min');
SELECT cron.schedule(
  'bep20-sweep-every-10-min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url:='https://eygkdpfjrjwwbiackfpr.supabase.co/functions/v1/bep20-sweep',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z2tkcGZqcmp3d2JpYWNrZnByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjkyMzEsImV4cCI6MjA5NjE0NTIzMX0.KQQkvoNmrXROOEHzSsePcyvpDEmbrueNEmtnvJlZ-dU"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  );
  $$
);
