-- 部分退款：累计已退金额，允许同一订单多次退款；退款申请记录本次处理金额。
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refunded_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE shop_refund_requests ADD COLUMN IF NOT EXISTS amount_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE shop_refund_requests ADD COLUMN IF NOT EXISTS refunded_cents BIGINT NOT NULL DEFAULT 0;

-- 历史已全额退款的订单补齐累计金额（只处理迁移前状态）。
UPDATE shop_orders SET refunded_cents = total_cents
WHERE payment_status = 'refunded' AND refunded_cents = 0;

-- 部分退款状态必须进入数据库约束，否则记录累计金额时会被拒绝。
ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_payment_status_check;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_payment_status_check
  CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','partially_refunded'));
