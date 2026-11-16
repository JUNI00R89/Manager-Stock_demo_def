-- Local digital wallets (Nequi, Daviplata, Bre-B): which one and the optional transaction reference.
ALTER TABLE sale_payments ADD COLUMN provider TEXT;
ALTER TABLE sale_payments ADD COLUMN reference TEXT NOT NULL DEFAULT '';
