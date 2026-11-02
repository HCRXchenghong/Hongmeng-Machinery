-- 按国家/地区配置运费；空数组时沿用 shipping_mode / shipping_cents 的全局规则。
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS shipping_zones JSONB NOT NULL DEFAULT '[]'::jsonb;
