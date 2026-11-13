ALTER TABLE service_appointments ADD COLUMN sale_id TEXT REFERENCES sales(id);
CREATE TABLE service_sale_lines (
  sale_id TEXT PRIMARY KEY REFERENCES sales(id),
  appointment_id TEXT NOT NULL UNIQUE REFERENCES service_appointments(id),
  service_id TEXT NOT NULL REFERENCES service_catalog(id),
  service_name TEXT NOT NULL,
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  line_total REAL NOT NULL CHECK(line_total >= 0)
);
