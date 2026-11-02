-- 自动税费与退款申请：Stripe Tax 的税额、退款申请队列、退款处理结果。
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tax_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refunded_by TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS shop_refund_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_by TEXT NOT NULL DEFAULT '',
  refund_id TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_refund_requests_one_pending
  ON shop_refund_requests(order_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS shop_refund_requests_status_idx
  ON shop_refund_requests(status, requested_at DESC);
