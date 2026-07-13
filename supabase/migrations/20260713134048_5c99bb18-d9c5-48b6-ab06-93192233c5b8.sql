
ALTER TABLE public.bot_customers DISABLE TRIGGER USER;
UPDATE public.bot_customers SET balance=0.00, updated_at=now() 
WHERE id=(SELECT customer_id FROM public.bot_deposits WHERE txn_hash='DGD1CCRWQR');
ALTER TABLE public.bot_customers ENABLE TRIGGER USER;
