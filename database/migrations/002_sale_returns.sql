CREATE TABLE sale_returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  reason TEXT NOT NULL,
  total REAL NOT NULL CHECK(total >= 0),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,idempotency_key)
);
CREATE TABLE sale_return_items (
  id INTEGER PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sale_returns(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  restock INTEGER NOT NULL CHECK(restock IN (0,1)),
  amount REAL NOT NULL CHECK(amount >= 0),
  UNIQUE(return_id,sale_item_id)
);
CREATE TABLE sale_return_payments (
  return_id TEXT NOT NULL REFERENCES sale_returns(id),
  method TEXT NOT NULL CHECK(method IN ('cash','card','digital','transfer')),
  amount REAL NOT NULL CHECK(amount > 0),
  PRIMARY KEY(return_id,method)
);
CREATE INDEX idx_sale_returns_business_sale ON sale_returns(business_id,sale_id);
CREATE INDEX idx_sale_returns_cash ON sale_returns(cash_session_id);
