-- 游客下单 + 下单时的同意凭据
-- 1) 报价类订单不再强制登录：游客也能提交订单请求，报价走邮箱回复。
-- 2) 记录「下单那一刻的同意时间」，作为可选存储同意的服务端凭据（浏览器存储被清掉后仍可举证）。
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS consent_analytics_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_shop_orders_email_claim ON shop_orders (lower(email)) WHERE customer_id IS NULL;
