-- Migrate existing 'pending' messages to 'delivered' since there is no queue.
-- Messages are broadcast immediately on insert, so 'pending' was never accurate.
UPDATE messages SET delivery_status = 'delivered' WHERE delivery_status = 'pending';
