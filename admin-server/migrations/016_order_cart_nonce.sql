-- 客户端购物车批次标识：区分「重复提交同一批」与「又一次真的下单同样的东西」
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cart_nonce TEXT NOT NULL DEFAULT '';
