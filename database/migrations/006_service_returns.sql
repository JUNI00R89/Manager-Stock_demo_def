CREATE TABLE service_return_amounts (
  return_id TEXT PRIMARY KEY REFERENCES sale_returns(id),
  amount REAL NOT NULL CHECK(amount > 0)
);
