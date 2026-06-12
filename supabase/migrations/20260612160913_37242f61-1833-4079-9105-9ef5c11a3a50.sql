ALTER TABLE public.link_check_jobs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.link_check_jobs;