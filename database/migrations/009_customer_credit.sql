-- Fiado: credit sales per customer, a credit limit set by the owner, and payments (abonos) received through the till.
ALTER TABLE customers ADD COLUMN credit_limit REAL NOT NULL DEFAULT 0 CHECK(credit_limit >= 0);

-- 'credit' becomes a payment method of a sale and of a refund (a return of a credit sale lowers the debt).
CREATE TABLE sale_payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK(method IN ('cash','card','digital','transfer','credit')),
  amount REAL NOT NULL CHECK(amount >= 0),
  provider TEXT,
  reference TEXT NOT NULL DEFAULT ''
);
INSERT INTO sale_payments_new (id,sale_id,method,amount,provider,reference) SELECT id,sale_id,method,amount,provider,reference FROM sale_payments;
DROP TABLE sale_payments;
ALTER TABLE sale_payments_new RENAME TO sale_payments;
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE sale_return_payments_new (
  return_id TEXT NOT NULL REFERENCES sale_returns(id),
  method TEXT NOT NULL CHECK(method IN ('cash','card','digital','transfer','credit')),
  amount REAL NOT NULL CHECK(amount > 0),
  PRIMARY KEY(return_id,method)
);
INSERT INTO sale_return_payments_new SELECT return_id,method,amount FROM sale_return_payments;
DROP TABLE sale_return_payments;
ALTER TABLE sale_return_payments_new RENAME TO sale_return_payments;

CREATE TABLE customer_credit_payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount REAL NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL CHECK(method IN ('cash','card','digital','transfer')),
  provider TEXT,
  reference TEXT NOT NULL DEFAULT '',
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,idempotency_key)
);
CREATE INDEX idx_credit_payments_customer ON customer_credit_payments(business_id,customer_id);
CREATE INDEX idx_credit_payments_cash ON customer_credit_payments(cash_session_id);
