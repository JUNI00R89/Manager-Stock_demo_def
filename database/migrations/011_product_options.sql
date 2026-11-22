-- Restaurant add-ons: option groups (size, protein, extras…) linked to products, each option with a price
-- and an optional ingredient it consumes. Orders and sales keep a snapshot of what was chosen and its price.
CREATE TABLE product_option_groups (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0 CHECK(min_select >= 0),
  max_select INTEGER NOT NULL DEFAULT 1 CHECK(max_select >= 1 AND max_select >= min_select),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_option_groups_business ON product_option_groups(business_id, active);

CREATE TABLE product_options (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  group_id TEXT NOT NULL REFERENCES product_option_groups(id),
  name TEXT NOT NULL,
  price_delta REAL NOT NULL DEFAULT 0 CHECK(price_delta >= 0),
  ingredient_id TEXT REFERENCES products(id),
  ingredient_quantity REAL NOT NULL DEFAULT 0 CHECK(ingredient_quantity >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX idx_options_group ON product_options(group_id, active, position);

CREATE TABLE product_option_links (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  group_id TEXT NOT NULL REFERENCES product_option_groups(id),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(product_id, group_id)
);
CREATE INDEX idx_option_links_group ON product_option_links(group_id);

CREATE TABLE order_item_options (
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  option_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  option_name TEXT NOT NULL,
  price_delta REAL NOT NULL,
  ingredient_id TEXT,
  ingredient_quantity REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_order_item_options_item ON order_item_options(order_item_id);

CREATE TABLE sale_item_options (
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  option_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  option_name TEXT NOT NULL,
  price_delta REAL NOT NULL,
  ingredient_id TEXT,
  ingredient_quantity REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_item_options_item ON sale_item_options(sale_item_id);
