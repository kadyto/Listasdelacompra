export interface Store {
  id: number;
  name: string;
  notes: string;
  active: number;
  list_id: number;
  pending_count: number;
  priced_count: number;
  estimated_cents: number;
}
export interface Category {
  id: number;
  name: string;
  product_count: number;
}
export interface Association {
  list_id: number;
  store_id: number;
  store_name: string;
  store_active?: number;
  purchased: number;
  quantity?: number;
  item_id?: number;
}
export interface Product {
  id: number;
  name: string;
  brand: string;
  category_id: number;
  category_name: string;
  package_amount: number;
  unit: string;
  ean: string | null;
  notes: string;
  lists?: Association[];
}
export interface Price {
  id: number;
  product_id: number;
  store_id: number;
  cents: number;
  recorded_at: string;
  created_at: string;
  notes: string;
  on_sale: number;
  store_name: string;
  store_active?: number;
  product_name?: string;
  brand?: string;
  package_amount?: number;
  unit?: string;
  unit_price?: { cents: number; unit: string };
  difference?: { cents: number; percent: number | null } | null;
}
export interface Item {
  id: number;
  list_id: number;
  product_id: number;
  name: string;
  brand: string;
  category_id: number;
  category_name: string;
  package_amount: number;
  unit: string;
  quantity: number;
  purchased: number;
  notes: string;
  position: number;
  prices: Price[];
}
export interface ShoppingList {
  store: Store;
  list: { id: number; name: string };
  items: Item[];
}
export interface ProductDetail {
  product: Product;
  lists: Association[];
  latest: Price[];
  history: Price[];
}
export interface Dashboard {
  stores: Store[];
  product_count: number;
  recent_prices: Price[];
}
