-- Fingerprint of the original sale request: a reused idempotency key must carry the same content.
ALTER TABLE sales ADD COLUMN request_hash TEXT;
