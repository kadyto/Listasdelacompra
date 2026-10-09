CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL UNIQUE
);
CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  normalized_name TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  brand TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  package_amount REAL NOT NULL CHECK(package_amount > 0),
  unit TEXT NOT NULL CHECK(unit IN ('ud', 'kg', 'g', 'l', 'ml')),
  ean TEXT UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  identity_key TEXT NOT NULL UNIQUE,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE shopping_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  name TEXT NOT NULL DEFAULT 'Mi lista',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_list_per_store ON shopping_lists(store_id) WHERE active = 1;
CREATE TABLE list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 999),
  purchased INTEGER NOT NULL DEFAULT 0 CHECK(purchased IN (0, 1)),
  added_at TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(list_id, product_id)
);
CREATE TABLE price_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  cents INTEGER NOT NULL CHECK(cents BETWEEN 0 AND 99999999),
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  on_sale INTEGER NOT NULL DEFAULT 0 CHECK(on_sale IN (0, 1))
);
CREATE INDEX prices_by_product_store_date ON price_records(product_id, store_id, recorded_at DESC, id DESC);
CREATE INDEX items_by_product ON list_items(product_id);
