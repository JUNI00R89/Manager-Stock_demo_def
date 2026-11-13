ALTER TABLE physical_counts ADD COLUMN idempotency_key TEXT;
ALTER TABLE physical_counts ADD COLUMN request_hash TEXT;
ALTER TABLE physical_counts ADD COLUMN approved_by TEXT REFERENCES auth_users(id);
ALTER TABLE physical_count_items ADD COLUMN observed_movement_id INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_count_request ON physical_counts(business_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
