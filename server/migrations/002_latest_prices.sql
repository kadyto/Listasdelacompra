CREATE VIEW latest_prices AS
SELECT id, product_id, store_id, cents, recorded_at, created_at, notes, on_sale
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY product_id, store_id ORDER BY recorded_at DESC, id DESC) AS row_number
  FROM price_records
) WHERE row_number = 1;
