ALTER TABLE bot_orders DROP CONSTRAINT bot_orders_product_id_fkey;
ALTER TABLE bot_orders ADD CONSTRAINT bot_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES bot_products(id) ON DELETE CASCADE;

ALTER TABLE bot_deposits DROP CONSTRAINT bot_deposits_pending_product_id_fkey;
ALTER TABLE bot_deposits ADD CONSTRAINT bot_deposits_pending_product_id_fkey FOREIGN KEY (pending_product_id) REFERENCES bot_products(id) ON DELETE SET NULL;