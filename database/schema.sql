PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'food',
  currency TEXT NOT NULL DEFAULT 'COP',
  tax_rate REAL NOT NULL DEFAULT 0.19,
  settings_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  suspension_reason TEXT NOT NULL DEFAULT '',
  suspension_description TEXT NOT NULL DEFAULT '',
  suspended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('superadmin','owner','business_admin','cashier')),
  custom_role_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_users_business ON auth_users(business_id,role,active);

CREATE TABLE IF NOT EXISTS custom_roles (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, name)
);

CREATE TABLE IF NOT EXISTS support_cases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','awaiting_business','resolved','closed')),
  created_by TEXT REFERENCES auth_users(id),
  updated_by TEXT REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES auth_users(id),
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_cases_business_status ON support_cases(business_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_case ON support_messages(case_id,id);

CREATE TABLE IF NOT EXISTS platform_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL REFERENCES auth_users(id),
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','owner','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, email)
);


CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_name_ci ON product_categories(business_id, lower(trim(name)));

CREATE TABLE IF NOT EXISTS business_type_transitions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  old_type TEXT NOT NULL,
  new_type TEXT NOT NULL,
  old_settings_json TEXT NOT NULL,
  cleanup_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','restored','expired','preserved')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cleaned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_business_transitions_pending ON business_type_transitions(status, expires_at);

CREATE TABLE IF NOT EXISTS hotel_rooms (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT 'double',
  floor INTEGER NOT NULL DEFAULT 1 CHECK(floor >= 0),
  capacity INTEGER NOT NULL DEFAULT 2 CHECK(capacity > 0),
  price_per_night REAL NOT NULL DEFAULT 0 CHECK(price_per_night >= 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','occupied','reserved','maintenance','cleaning')),
  amenities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleaning_status TEXT NOT NULL DEFAULT 'inspeccionada',
  cleaning_assignee TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, room_number)
);
CREATE INDEX IF NOT EXISTS idx_hotel_rooms_business_status ON hotel_rooms(business_id,status,room_number);

CREATE TABLE IF NOT EXISTS hotel_reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL DEFAULT '',
  guest_phone TEXT NOT NULL DEFAULT '',
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','checkin','checkout','cancelled')),
  advance REAL NOT NULL DEFAULT 0 CHECK(advance >= 0),
  total_charges REAL NOT NULL DEFAULT 0 CHECK(total_charges >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(check_out > check_in)
);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_business_dates ON hotel_reservations(business_id,check_in,check_out,status);

CREATE TABLE IF NOT EXISTS hotel_charges (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  UNIQUE(business_id, reservation_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_hotel_charges_reservation ON hotel_charges(business_id,reservation_id);

CREATE TABLE IF NOT EXISTS hotel_payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  amount REAL NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL CHECK(method IN ('cash','card','transfer','digital')),
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,reservation_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_cash ON hotel_payments(cash_session_id,method);
CREATE TABLE IF NOT EXISTS hotel_account_closures (
  reservation_id TEXT PRIMARY KEY REFERENCES hotel_reservations(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  receipt_id TEXT NOT NULL UNIQUE,
  closed_at TEXT NOT NULL,
  receipt_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_catalog (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK(duration_minutes > 0),
  price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
  category TEXT NOT NULL DEFAULT 'Servicios principales',
  color TEXT NOT NULL DEFAULT '#315F68',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,name)
);
CREATE INDEX IF NOT EXISTS idx_service_catalog_business_active ON service_catalog(business_id,active,name);

CREATE TABLE IF NOT EXISTS service_professionals (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#315F68',
  availability_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,name)
);
CREATE INDEX IF NOT EXISTS idx_service_professionals_business_active ON service_professionals(business_id,active,name);

CREATE TABLE IF NOT EXISTS service_appointments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES service_catalog(id),
  professional_id TEXT NOT NULL REFERENCES service_professionals(id),
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  service_name_snapshot TEXT NOT NULL,
  professional_name_snapshot TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
  price_snapshot REAL NOT NULL CHECK(price_snapshot >= 0),
  appointment_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','confirmed','attended','cancelled','no_show')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_service_appointments_business_date ON service_appointments(business_id,appointment_date,start_time,status);
CREATE INDEX IF NOT EXISTS idx_service_appointments_professional_slot ON service_appointments(business_id,professional_id,appointment_date,start_time,end_time,status);

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT '',
  aisle TEXT NOT NULL DEFAULT '',
  rack TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 0),
  capacity REAL NOT NULL DEFAULT 0 CHECK(capacity >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, code)
);
CREATE INDEX IF NOT EXISTS idx_warehouse_locations_business ON warehouse_locations(business_id,active,zone,code);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0),
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0 CHECK(min_stock >= 0),
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT 'sale_item' CHECK(product_type IN ('sale_item','ingredient','supplies')),
  unit TEXT NOT NULL DEFAULT 'unidad',
  supplier_id TEXT REFERENCES suppliers(id),
  barcode TEXT NOT NULL DEFAULT '',
  track_lots INTEGER NOT NULL DEFAULT 0 CHECK(track_lots IN (0,1)),
  default_location_id TEXT REFERENCES warehouse_locations(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id,barcode);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(business_id,supplier_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_products (
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  PRIMARY KEY(supplier_id, product_id)
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  idempotency_key TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT 'Cliente general',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  currency TEXT NOT NULL DEFAULT 'COP',
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  line_discount REAL NOT NULL DEFAULT 0,
  global_discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0.19,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL CHECK(total >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','pending','cancelled')),
  created_by TEXT,
  cash_session_id TEXT REFERENCES cash_sessions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  unit_cost_snapshot REAL NOT NULL DEFAULT 0 CHECK(unit_cost_snapshot >= 0),
  discount_percent REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL CHECK(line_total >= 0)
);


CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK(method IN ('cash','card','digital','transfer')),
  amount REAL NOT NULL CHECK(amount >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_operations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('purchase','customer_return','donation','consumption','waste','adjustment','transfer','count','production','opening','other')),
  supplier_id TEXT REFERENCES suppliers(id),
  reference TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL DEFAULT '',
  invoice_ref TEXT NOT NULL DEFAULT '',
  attachment_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_operations_business ON inventory_operations(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS product_lots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lot_code TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  expiry_date TEXT,
  unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
  location_id TEXT REFERENCES warehouse_locations(id),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, product_id, lot_code)
);
CREATE INDEX IF NOT EXISTS idx_product_lots_fefo ON product_lots(business_id,product_id,expiry_date,received_at);
CREATE INDEX IF NOT EXISTS idx_product_lots_expiry ON product_lots(business_id,expiry_date);
CREATE INDEX IF NOT EXISTS idx_product_lots_location ON product_lots(business_id,location_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sale_id TEXT REFERENCES sales(id),
  order_id TEXT REFERENCES orders(id),
  operation_id TEXT REFERENCES inventory_operations(id),
  lot_id TEXT REFERENCES product_lots(id),
  location_id TEXT REFERENCES warehouse_locations(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','purchase','customer_return','donation','sale','sale_cancelled','recipe_consumption','consumption','adjustment','transfer_in','transfer_out','waste','count_adjustment','production')),
  quantity_delta REAL NOT NULL,
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_business_date ON inventory_movements(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(business_id, movement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_sale ON inventory_movements(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(business_id, reference_type, reference_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','partial','received','cancelled')),
  expected_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_business ON purchase_orders(business_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_ordered REAL NOT NULL CHECK(quantity_ordered > 0),
  quantity_received REAL NOT NULL DEFAULT 0 CHECK(quantity_received >= 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
  unit TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);

CREATE TABLE IF NOT EXISTS physical_counts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'closed' CHECK(status IN ('open','closed','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_physical_counts_business ON physical_counts(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS physical_count_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT NOT NULL REFERENCES physical_counts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  system_quantity REAL NOT NULL,
  counted_quantity REAL NOT NULL,
  difference REAL NOT NULL,
  adjustment_movement_id INTEGER REFERENCES inventory_movements(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_physical_count_items_count ON physical_count_items(count_id);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  origin_location_id TEXT REFERENCES warehouse_locations(id),
  destination_location_id TEXT REFERENCES warehouse_locations(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','in_transit','received','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  received_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_business ON inventory_transfers(business_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  lot_id TEXT REFERENCES product_lots(id),
  lot_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  unit_cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_items_transfer ON inventory_transfer_items(transfer_id);

CREATE TABLE IF NOT EXISTS inventory_transfer_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_item_id INTEGER NOT NULL REFERENCES inventory_transfer_items(id) ON DELETE CASCADE,
  lot_code TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_allocations_item ON inventory_transfer_allocations(transfer_item_id);

CREATE TABLE IF NOT EXISTS supplier_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
  source TEXT NOT NULL DEFAULT '',
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_price_history_product ON supplier_price_history(business_id,product_id,created_at DESC);

CREATE TABLE IF NOT EXISTS product_substitutions (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  substitute_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(business_id, product_id, substitute_id)
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  opened_by TEXT NOT NULL,
  opened_by_user_id TEXT REFERENCES auth_users(id),
  opening_amount REAL NOT NULL DEFAULT 0,
  closing_amount REAL,
  expected_amount REAL,
  difference REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  channel TEXT NOT NULL DEFAULT 'counter' CHECK(channel IN ('counter','takeaway','delivery','table')),
  customer TEXT NOT NULL DEFAULT 'Cliente general',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','preparing','ready','delivered','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  table_number INTEGER,
  waiter TEXT NOT NULL DEFAULT '',
  restaurant_metadata TEXT NOT NULL DEFAULT '{}',
  stock_consumed INTEGER NOT NULL DEFAULT 0 CHECK(stock_consumed IN (0,1)),
  sale_id TEXT REFERENCES sales(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  number INTEGER NOT NULL,
  zone TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_tables_number ON restaurant_tables(business_id, number);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  yield_quantity REAL NOT NULL DEFAULT 1,
  instructions TEXT NOT NULL DEFAULT '',
  UNIQUE(product_id)
);

CREATE TABLE IF NOT EXISTS recipe_items (
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  ingredient_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(recipe_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_business_active ON products(business_id, active);
CREATE INDEX IF NOT EXISTS idx_sales_business_date ON sales(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_business_status ON orders(business_id, status);
