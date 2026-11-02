ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS highlights JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS videos JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS shop_customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  legal_name TEXT NOT NULL DEFAULT '',
  payment_customer_id TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_customer_sessions_expiry ON shop_customer_sessions(expires_at);

CREATE TABLE IF NOT EXISTS shop_customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL,
  phone TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'United States',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_customer_addresses_customer ON shop_customer_addresses(customer_id, is_default DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_customer_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google','facebook')),
  subject TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, subject),
  UNIQUE(provider, customer_id)
);

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES shop_customers(id) ON DELETE SET NULL;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded'));
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS provider_payment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS legal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_url TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer ON shop_orders(customer_id, created_at DESC);

ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CNY'));
ALTER TABLE shop_settings ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE shop_products ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE shop_orders ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'manual' CHECK (payment_provider IN ('manual','stripe','paypal'));
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS privacy_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS cookie_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS terms_policy TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS storefront_content JSONB NOT NULL DEFAULT '{}'::jsonb;
