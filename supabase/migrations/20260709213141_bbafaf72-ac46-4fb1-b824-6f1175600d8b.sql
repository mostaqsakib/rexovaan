
SELECT cron.schedule(
  'ton-watcher-1m',
  '*/1 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://eygkdpfjrjwwbiackfpr.supabase.co/functions/v1/ton-watcher',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5Z2tkcGZqcmp3d2JpYWNrZnByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjkyMzEsImV4cCI6MjA5NjE0NTIzMX0.KQQkvoNmrXROOEHzSsePcyvpDEmbrueNEmtnvJlZ-dU"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
