
-- Top-up $0.10 to cover BDT rate shortfall ($0.80 paid vs $0.90 price)
UPDATE public.bot_customers 
SET balance = 0.10, 
    pending_action = NULL,
    updated_at = now() 
WHERE id = '4dd85d98-0855-44ee-8961-9bea2509cd80';

-- Reset deposit so admin-verify-deposit can re-run with auto-delivery
UPDATE public.bot_deposits 
SET status = 'pending', 
    verified_at = NULL,
    pending_product_id = '680f3601-4f9f-4e4f-933a-f3670371b681',
    pending_quantity = 2
WHERE id = '94740237-3fc9-4470-a084-80d89897a970';
