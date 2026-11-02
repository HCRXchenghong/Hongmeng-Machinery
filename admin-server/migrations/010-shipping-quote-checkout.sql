-- Persist the seller's quote, customer's acceptance, and reusable payment session.
ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS shipping_quoted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipping_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT NOT NULL DEFAULT '';

ALTER TABLE shop_orders
  DROP CONSTRAINT IF EXISTS shop_orders_shipping_status_check;

ALTER TABLE shop_orders
  ADD CONSTRAINT shop_orders_shipping_status_check
  CHECK (shipping_status IN ('quote_pending','quoted','accepted','included','collect'));
