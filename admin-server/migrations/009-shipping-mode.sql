-- Until a seller enters an actual freight rate, checkout collects an order
-- request and keeps freight/payment in manual confirmation mode.
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS shipping_mode TEXT NOT NULL DEFAULT 'quote';

ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS shipping_status TEXT NOT NULL DEFAULT 'quoted';

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_settings_shipping_mode_check') THEN
    ALTER TABLE shop_settings
      ADD CONSTRAINT shop_settings_shipping_mode_check CHECK (shipping_mode IN ('quote','flat'));
  END IF;
END;
$constraint$;

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_orders_shipping_status_check') THEN
    ALTER TABLE shop_orders
      -- 用全集：后续迁移新增过 accepted/collect，旧库若缺约束又不能漏掉这些值。
      ADD CONSTRAINT shop_orders_shipping_status_check CHECK (shipping_status IN ('quote_pending','quoted','accepted','included','collect'));
  END IF;
END;
$constraint$;
