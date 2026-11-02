-- 商品级运费：按地区覆盖通用运费，未命中时回退商品默认行为（通用/到付/人工加运费）。
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS shipping_rules JSONB NOT NULL DEFAULT '{"mode":"inherit","zones":[]}'::jsonb;

ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_shipping_status_check;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_shipping_status_check
  CHECK (shipping_status IN ('quote_pending','quoted','accepted','included','collect'));
