-- 邮箱验证码 + 邮件发送设置
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'register',
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_verification_codes (lower(email), purpose, created_at DESC);

-- 下单同意凭据的服务端依据：埋点响应下发的签名 Cookie（HttpOnly，前端读不到）
CREATE TABLE IF NOT EXISTS mail_log (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mail_log_created ON mail_log (created_at DESC);

-- 客户端购物车批次标识：区分「重复提交同一批」与「又一次真的下单同样的东西」
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS cart_nonce TEXT NOT NULL DEFAULT '';
