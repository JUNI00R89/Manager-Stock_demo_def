CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'CC',
  document_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  municipality_code TEXT NOT NULL DEFAULT '',
  person_type TEXT NOT NULL DEFAULT 'natural',
  tax_responsibilities TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_customer_document ON customers(business_id,document_type,document_number) WHERE document_number <> '';
CREATE INDEX idx_customer_search ON customers(business_id,active,name);
CREATE TABLE customer_operations (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('sale','hotel','appointment')),
  source_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_snapshot TEXT NOT NULL,
  PRIMARY KEY(business_id,source_type,source_id)
);
CREATE TABLE billing_profiles (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  profile_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE billing_drafts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('sale','hotel')),
  source_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,source_type,source_id)
);
