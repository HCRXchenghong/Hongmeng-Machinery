import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommerceRouter, orderInput, productInput } from './commerce-router.mjs';
import { signConsent } from './consent-cookie.mjs';

const validOrder = () => ({
  customer: { name: '测试客户', email: 'buyer@example.com', phone: '13800000000' },
  shipping_address: { city: '上海', line1: '测试路 1 号' },
  items: [{ id: 'product-1', quantity: 1 }],
  idempotency_key: 'test-order-1',
  expected_total_cents: 9900,
  consent_analytics_at: new Date().toISOString()
});

test('订单校验拒绝空商品条目和缺失的确认金额', () => {
  assert.throws(() => orderInput({ ...validOrder(), items: [null] }), { status: 400 });
  assert.throws(() => orderInput({ ...validOrder(), items: [42] }), { status: 400 });
  assert.throws(() => orderInput({ ...validOrder(), expected_total_cents: null }), { status: 400 });
  assert.throws(() => orderInput({ ...validOrder(), expected_total_cents: 2_147_483_648 }), { status: 400 });
});

test('结账会保留客户选择的支付通道，并拒绝未知通道', () => {
  assert.equal(orderInput({ ...validOrder(), payment_provider: 'paypal' }).payment_provider, 'paypal');
  assert.throws(() => orderInput({ ...validOrder(), payment_provider: 'wire-transfer' }), { status: 400 });
});

function routerFor(body, query) {
  const replies = [];
  const router = createCommerceRouter({
    store: { withTransaction: (run) => run({ query }) },
    bodyJson: async () => body,
    json: (_res, status, payload) => replies.push({ status, payload }),
    verifySession: () => true
  });
  return { router, replies };
}

test('确认金额与实时商品和运费不一致时不写入订单', async () => {
  const queries = [];
  const { router, replies } = routerFor(validOrder(), async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM shop_orders WHERE idempotency_key')) return { rows: [] };
    if (sql.includes('FROM shop_orders WHERE status')) return { rows: [] };
    if (sql.includes('FROM shop_settings')) return { rows: [{ shipping_mode: 'flat', checkout_enabled: true, shipping_cents: 500 }] };
    if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: '附件', price_cents: 9900, currency: 'CNY', image_url: '', stock: 1, allow_backorder: false }] };
    if (sql.startsWith('UPDATE shop_products SET stock=stock-')) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: {}, socket: { remoteAddress: 'test' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/shop/orders');
  assert.equal(replies[0].status, 409);
  assert.ok(queries.every((sql) => !sql.includes('INSERT INTO shop_orders')));
});

test('商品必须有有效详情字段，且上架商品价格必须大于零', () => {
  const product = { id: 'product-1', sku: 'SKU-1', slug: 'sample-product', name: '商品', price_cents: 1, stock: 2, active: true };
  assert.equal(productInput(product).price_cents, 1);
  assert.equal(productInput({ ...product, allow_backorder: true }).allow_backorder, true);
  assert.throws(() => productInput({ ...product, price_cents: 0 }), { status: 400 });
});

test('商品 sitemap 为每种语言输出详情 URL、互链 hreflang 和商品图片', async () => {
  let body = '';
  const headers = {};
  const store = { query: async () => ({ rows: [{ slug: 'mm38-mulcher', updated_at: new Date('2026-10-22T00:00:00Z'), image_url: '/assets/mm38.webp', gallery: ['https://cdn.example.com/mm38-side.webp'] }] }) };
  const router = createCommerceRouter({ store, json: () => assert.fail('sitemap must return XML'), verifySession: () => true, siteOrigin: 'https://shop.example.com/' });
  await router({ method: 'GET', url: '/site-admin-api/shop/sitemap-products.xml', headers: {} }, {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(status, values) { headers.status = status; Object.assign(headers, Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]))); },
    end(value) { body = String(value); }
  }, '/site-admin-api/shop/sitemap-products.xml');
  assert.equal(headers.status, 200);
  assert.match(headers['content-type'], /application\/xml/);
  assert.match(body, /https:\/\/shop\.example\.com\/shop\/product\/mm38-mulcher\//);
  assert.match(body, /https:\/\/shop\.example\.com\/zh\/shop\/product\/mm38-mulcher\//);
  assert.match(body, /https:\/\/shop\.example\.com\/ar\/shop\/product\/mm38-mulcher\//);
  assert.match(body, /hreflang="zh-CN"/);
  assert.match(body, /https:\/\/cdn\.example\.com\/mm38-side\.webp/);
});

test('订单不允许跳过状态流转', async () => {
  const queries = [];
  const { router, replies } = routerFor({ status: 'shipped', tracking_number: 'TRACK-1' }, async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM shop_orders WHERE id')) return { rows: [{ id: 'order-1', status: 'pending', subtotal_cents: 9900, total_cents: 9900, items: [], tracking_number: '' }] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await router({ method: 'PATCH', url: '/site-admin-api/commerce/orders/order-1' }, {}, '/site-admin-api/commerce/orders/order-1');
  assert.equal(replies[0].status, 409);
  assert.ok(queries.every((sql) => !sql.startsWith('UPDATE shop_orders')));
});

test('报价待定订单不能进入确认或发货状态，直到后台提交运费报价', async () => {
  const replies = [];
  const updates = [];
  let current = { id: 'order-quote', status: 'pending', shipping_status: 'quote_pending', shipping_cents: 0, subtotal_cents: 9900, total_cents: 9900, payment_status: 'unpaid', items: [], tracking_number: '' };
  const store = {
    withTransaction: (run) => run({ query: async (sql, params = []) => {
      if (sql.includes('SELECT * FROM shop_orders WHERE id = $1')) return { rows: [current] };
      if (sql.startsWith('UPDATE shop_orders')) {
        updates.push({ sql, params });
        current = { ...current, status: params[1], shipping_cents: params[4], total_cents: params[5], shipping_status: params[6] };
        return { rows: [current] };
      }
      return { rows: [] };
    } })
  };
  const router = createCommerceRouter({ store, bodyJson: async () => ({ status: 'confirmed', tracking_number: '', tracking_url: '' }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'PATCH', url: '/site-admin-api/commerce/orders/order-quote' }, {}, '/site-admin-api/commerce/orders/order-quote');
  assert.equal(replies[0].status, 409);
  assert.equal(updates.length, 0);

  const quoteRouter = createCommerceRouter({ store, bodyJson: async () => ({ status: 'pending', tracking_number: '', tracking_url: '', shipping_cents: 1300 }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await quoteRouter({ method: 'PATCH', url: '/site-admin-api/commerce/orders/order-quote' }, {}, '/site-admin-api/commerce/orders/order-quote');
  assert.equal(replies[1].status, 200);
  assert.equal(replies[1].payload.data.shipping_status, 'quoted');
  assert.equal(replies[1].payload.data.total_cents, 11200);
  const confirmRouter = createCommerceRouter({ store, bodyJson: async () => ({ status: 'confirmed', tracking_number: '', tracking_url: '' }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await confirmRouter({ method: 'PATCH', url: '/site-admin-api/commerce/orders/order-quote' }, {}, '/site-admin-api/commerce/orders/order-quote');
  assert.equal(replies[2].status, 409);
  current.shipping_accepted_at = new Date().toISOString();
  await confirmRouter({ method: 'PATCH', url: '/site-admin-api/commerce/orders/order-quote' }, {}, '/site-admin-api/commerce/orders/order-quote');
  assert.equal(replies[3].status, 200);
});

test('未确认运费时拒绝 Stripe / PayPal 在线结账', async () => {
  const replies = [];
  let inserted = false;
  const store = {
    withTransaction: (run) => run({ query: async (sql) => {
      if (sql.includes('SELECT * FROM shop_orders WHERE idempotency_key')) return { rows: [] };
      if (sql.includes('SELECT * FROM shop_orders WHERE status')) return { rows: [] };
      if (sql.includes('SELECT * FROM shop_settings')) return { rows: [{ shipping_mode: 'quote', checkout_enabled: true, currency: 'USD', payment_provider: 'stripe' }] };
      if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: 'Attachment', price_cents: 9900, currency: 'USD', image_url: '', stock: 3, allow_backorder: false, shipping_rules: null }] };
      if (sql.startsWith('UPDATE shop_products SET stock=stock-')) return { rows: [] };
      if (sql.includes('INSERT INTO shop_orders')) inserted = true;
      return { rows: [] };
    } }),
    query: async (sql) => {
      if (sql.includes('shop_customer_sessions')) return { rows: [{ id: 'customer-1', email: 'buyer@example.com', payment_customer_id: '' }] };
      return { rows: [] };
    }
  };
  const router = createCommerceRouter({ store, bodyJson: async () => ({ ...validOrder(), payment_provider: 'stripe' }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: { cookie: 'hongmeng_customer_session=test-session' }, socket: { remoteAddress: 'test-quote-online' } }, { setHeader() {} }, '/site-admin-api/shop/orders');
  assert.equal(replies[0].status, 409);
  assert.equal(inserted, false);
});

test('公开商城只列出已配置的支付通道，不回传商户密钥', async () => {
  const replies = [];
  const store = {
    query: async () => ({ rows: [{ shipping_mode: 'quote', shipping_cents: 0, checkout_enabled: true, support_email: '', currency: 'USD', payment_provider: 'stripe' }] }),
    readRuntimeSetting: async () => ({ secrets: {
      stripeSecret: 'sk_test_private', stripeWebhookSecret: 'whsec_private',
      paypalClientId: 'paypal-client', paypalClientSecret: 'paypal-secret', paypalWebhookId: 'webhook-id'
    } })
  };
  const router = createCommerceRouter({ store, bodyJson: async () => ({}), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'GET', url: '/site-admin-api/shop/settings', headers: {} }, { setHeader() {} }, '/site-admin-api/shop/settings');
  assert.deepEqual(replies[0].payload.data.payment_methods, ['manual']);
  assert.deepEqual(replies[0].payload.data.quote_payment_methods, ['stripe', 'paypal']);
  assert.equal(JSON.stringify(replies[0].payload).includes('sk_test_private'), false);
  assert.equal(JSON.stringify(replies[0].payload).includes('paypal-secret'), false);
});

test('公开政策接口返回后台可配置的五项政策', async () => {
  const replies = [];
  const store = { query: async (sql) => {
    assert.match(sql, /privacy_policy,cookie_policy,terms_policy,shipping_policy,returns_policy/);
    return { rows: [{ privacy_policy: 'privacy', cookie_policy: 'cookies', terms_policy: 'terms', shipping_policy: 'shipping', returns_policy: 'returns' }] };
  } };
  const router = createCommerceRouter({ store, bodyJson: async () => ({}), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'GET', url: '/site-admin-api/shop/policies', headers: {} }, { setHeader() {} }, '/site-admin-api/shop/policies');
  assert.deepEqual(replies[0].payload.data, { privacy_policy: 'privacy', cookie_policy: 'cookies', terms_policy: 'terms', shipping_policy: 'shipping', returns_policy: 'returns' });
});

test('后台在线支付状态要求同时配置商户凭据和 Webhook', async () => {
  const replies = [];
  const store = {
    query: async () => ({ rows: [{ payment_provider: 'stripe', currency: 'USD' }] }),
    readRuntimeSetting: async () => ({ secrets: { stripeSecret: 'sk_test_only' } })
  };
  const router = createCommerceRouter({ store, bodyJson: async () => ({}), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'GET', url: '/site-admin-api/commerce/settings', headers: {} }, { setHeader() {} }, '/site-admin-api/commerce/settings');
  assert.equal(replies[0].payload.data.payment_configured, false);
});

test('后台可以切换报价运费与固定运费模式', async () => {
  const replies = [];
  let updateParams;
  const store = { query: async (_sql, params) => {
    updateParams = params;
    return { rows: [{ shipping_mode: params[0], shipping_cents: params[1], checkout_enabled: params[2], support_email: params[3], currency: params[4], payment_provider: params[5] }] };
  } };
  const router = createCommerceRouter({
    store,
    bodyJson: async () => ({ shipping_mode: 'flat', shipping_cents: 425, checkout_enabled: true, support_email: 'help@example.com', currency: 'USD', payment_provider: 'manual' }),
    json: (_res, status, payload) => replies.push({ status, payload }),
    verifySession: () => true
  });
  await router({ method: 'PATCH', url: '/site-admin-api/commerce/settings' }, {}, '/site-admin-api/commerce/settings');
  assert.equal(replies[0].status, 200);
  assert.equal(updateParams[0], 'flat');
  assert.equal(updateParams[1], 425);
  assert.equal(replies[0].payload.data.shipping_mode, 'flat');
});

test('客户必须通过自己的账户接受商家运费报价', async () => {
  const replies = [];
  let saved;
  const store = {
    query: async (sql) => sql.includes('shop_customer_sessions') ? { rows: [{ id: 'customer-1', email: 'buyer@example.com' }] } : { rows: [] },
    withTransaction: (run) => run({ query: async (sql, params = []) => {
      if (sql.includes('FROM shop_orders o LEFT JOIN shop_customers')) return { rows: [{ id: 'order-1', customer_id: 'customer-1', shipping_status: 'quoted', status: 'pending', payment_status: 'unpaid', subtotal_cents: 9900, shipping_cents: 1300, total_cents: 11200, currency: 'USD' }] };
      if (sql.startsWith('UPDATE shop_orders SET shipping_status=')) { saved = params; return { rows: [{ id: 'order-1', order_number: 'HM-QUOTE', shipping_status: 'accepted', payment_status: 'unpaid', shipping_accepted_at: new Date().toISOString() }] }; }
      return { rows: [] };
    } })
  };
  const router = createCommerceRouter({ store, bodyJson: async () => ({ payment_provider: 'manual' }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'POST', url: '/site-admin-api/shop/orders/order-1/accept-shipping', headers: { cookie: 'hongmeng_customer_session=customer-session' } }, { setHeader() {} }, '/site-admin-api/shop/orders/order-1/accept-shipping');
  assert.equal(replies[0].status, 200);
  assert.equal(replies[0].payload.data.accepted, true);
  assert.deepEqual(saved, ['order-1', 'manual']);
});

test('客户接受报价后可创建 Stripe 付款链接并复用该链接', async () => {
  const oldFetch = globalThis.fetch;
  const replies = [];
  const writes = [];
  const store = {
    readRuntimeSetting: async () => ({ secrets: { stripeSecret: 'sk_test_quote', stripeWebhookSecret: 'whsec_quote' } }),
    query: async (sql, params = []) => {
      if (sql.includes('shop_customer_sessions')) return { rows: [{ id: 'customer-1', email: 'buyer@example.com' }] };
      if (sql.includes('SET provider_payment_id=$2,checkout_url=$3')) writes.push(params);
      return { rows: [] };
    },
    withTransaction: (run) => run({ query: async (sql) => {
      if (sql.includes('FROM shop_orders o LEFT JOIN shop_customers')) return { rows: [{ id: 'order-1', order_number: 'HM-QUOTE', customer_id: 'customer-1', customer_name: 'Buyer', email: 'buyer@example.com', payment_customer_id: '', shipping_status: 'quoted', shipping_accepted_at: null, status: 'pending', payment_status: 'unpaid', payment_provider: 'manual', checkout_url: '', subtotal_cents: 9900, shipping_cents: 1300, total_cents: 11200, currency: 'USD', items: [{ name: 'Attachment', quantity: 1, price_cents: 9900 }] }] };
      if (sql.startsWith('UPDATE shop_orders SET shipping_status=')) return { rows: [{ id: 'order-1', order_number: 'HM-QUOTE', customer_name: 'Buyer', email: 'buyer@example.com', payment_customer_id: '', shipping_status: 'accepted', shipping_accepted_at: new Date().toISOString(), status: 'pending', payment_status: 'pending', payment_provider: 'stripe', subtotal_cents: 9900, shipping_cents: 1300, total_cents: 11200, currency: 'USD', items: [{ name: 'Attachment', quantity: 1, price_cents: 9900 }] }] };
      return { rows: [] };
    } })
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 'cs_quote', url: 'https://checkout.stripe.com/c/pay/cs_quote' }) });
  try {
    const router = createCommerceRouter({ store, bodyJson: async () => ({ payment_provider: 'stripe' }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
    await router({ method: 'POST', url: '/site-admin-api/shop/orders/order-1/accept-shipping', headers: { cookie: 'hongmeng_customer_session=customer-session' } }, { setHeader() {} }, '/site-admin-api/shop/orders/order-1/accept-shipping');
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(replies[0].status, 200);
  assert.equal(replies[0].payload.data.url, 'https://checkout.stripe.com/c/pay/cs_quote');
  assert.deepEqual(writes[0], ['order-1', 'cs_quote', 'https://checkout.stripe.com/c/pay/cs_quote']);
});

test('用户选择 Stripe 后订单使用该通道并返回托管结账地址', async () => {
  const oldFetch = globalThis.fetch;
  const replies = [];
  let insertedOrderValues;
  const store = {
    readRuntimeSetting: async () => ({ secrets: { stripeSecret: 'sk_test_unit', stripeWebhookSecret: 'whsec_unit' } }),
    withTransaction: async (run) => run({ query: async (sql, params = []) => {
      if (sql.includes('SELECT * FROM shop_orders WHERE idempotency_key')) return { rows: [] };
      if (sql.includes('SELECT * FROM shop_orders WHERE status')) return { rows: [] };
      if (sql.includes('SELECT * FROM shop_settings')) return { rows: [{ shipping_mode: 'flat', checkout_enabled: true, shipping_cents: 0, currency: 'USD', payment_provider: 'manual' }] };
      if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: '附件', price_cents: 9900, currency: 'USD', image_url: '', stock: 1, allow_backorder: false }] };
      if (sql.includes('INSERT INTO shop_orders')) {
        insertedOrderValues = params;
        return { rows: [{ id: 'order-1', order_number: 'HM-TEST', status: 'pending', payment_status: 'pending', payment_provider: params[13], total_cents: 9900, currency: 'USD', items: [{ name: '附件', quantity: 1, price_cents: 9900 }], shipping_cents: 0, subtotal_cents: 9900 }] };
      }
      return { rows: [] };
    } }),
    query: async () => ({ rows: [] })
  };
  let checkoutBody = '';
  globalThis.fetch = async (_url, options = {}) => { checkoutBody = String(options.body || ''); return { ok: true, json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }) }; };
  try {
    const router = createCommerceRouter({ store, bodyJson: async () => ({ ...validOrder(), payment_provider: 'stripe' }), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true, siteOrigin: 'https://store.example' });
    await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: {}, socket: { remoteAddress: 'test-payment-provider' } }, { setHeader() {} }, '/site-admin-api/shop/orders');
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(insertedOrderValues[13], 'stripe');
  const checkoutParams = new URLSearchParams(checkoutBody);
  assert.equal(checkoutParams.get('automatic_tax[enabled]'), 'true');
  assert.equal(checkoutParams.get('billing_address_collection'), 'required');
  assert.equal(checkoutParams.get('line_items[0][price_data][tax_behavior]'), 'exclusive');
  assert.equal(replies[0].status, 201);
  assert.equal(replies[0].payload.data.checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_123');
});

test('缺少现货时允许接单的商品可购买，且订单不会虚增库存', async () => {
  const replies = [];
  let insertedItems;
  let insertedShippingStatus;
  const store = {
    withTransaction: async (run) => run({ query: async (sql, params = []) => {
      if (sql.includes('SELECT * FROM shop_orders WHERE idempotency_key')) return { rows: [] };
      if (sql.includes('SELECT * FROM shop_orders WHERE status')) return { rows: [] };
      if (sql.includes('SELECT * FROM shop_settings')) return { rows: [{ shipping_mode: 'flat', checkout_enabled: true, shipping_cents: 0, currency: 'USD', payment_provider: 'manual' }] };
      if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: 'Attachment', price_cents: 9900, currency: 'USD', image_url: '', stock: 0, allow_backorder: true }] };
      if (sql.includes('INSERT INTO shop_orders')) {
        insertedItems = JSON.parse(params[7]);
        insertedShippingStatus = params[17];
        return { rows: [{ id: 'order-1', order_number: 'HM-TEST', status: 'pending', payment_status: 'unpaid', payment_provider: 'manual', total_cents: 9900, currency: 'USD', items: insertedItems }] };
      }
      if (sql.includes('INSERT INTO shop_order_events')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    } }),
    query: async () => ({ rows: [] })
  };
  const router = createCommerceRouter({ store, bodyJson: async () => validOrder(), json: (_res, status, payload) => replies.push({ status, payload }), verifySession: () => true });
  await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: {}, socket: { remoteAddress: 'test-backorder' } }, { setHeader() {} }, '/site-admin-api/shop/orders');
  assert.equal(replies[0].status, 201);
  assert.equal(insertedItems[0].stock_reserved_quantity, 0);
  assert.equal(insertedShippingStatus, 'included');
});

test('游客也能提交报价类订单，并记录同意时间戳', async () => {
  const consentAt = new Date(Date.now() - 60_000).toISOString();
  assert.equal(orderInput({ ...validOrder(), consent_analytics_at: 'not-a-date' }).consent_analytics_at, '');
  assert.equal(orderInput({ ...validOrder(), consent_analytics_at: consentAt }).consent_analytics_at, consentAt);

  const inserts = [];
  const { router, replies } = routerFor({ ...validOrder(), consent_analytics_at: consentAt }, async (sql, params) => {
    if (sql.includes('FROM shop_orders WHERE idempotency_key')) return { rows: [] };
    if (sql.includes('FROM shop_orders WHERE status')) return { rows: [] };
    if (sql.includes('FROM shop_settings')) return { rows: [{ shipping_mode: 'quote', checkout_enabled: true, currency: 'USD', payment_provider: 'manual', payment_methods: ['manual'] }] };
    if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: '附件', price_cents: 9900, currency: 'USD', image_url: '', stock: 5, allow_backorder: false }] };
    if (sql.startsWith('UPDATE shop_products SET stock=stock-')) return { rows: [] };
    if (sql.startsWith('INSERT INTO shop_orders')) {
      inserts.push(params);
      return { rows: [{ id: params[0], order_number: params[1], items: [], shipping_status: params[17], payment_status: 'unpaid', payment_provider: 'manual', total_cents: params[10], created_at: new Date().toISOString() }] };
    }
    if (sql.startsWith('INSERT INTO shop_order_events')) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: {}, socket: { remoteAddress: 'guest-quote' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/shop/orders');
  assert.equal(replies[0].status, 201, JSON.stringify(replies[0].payload));
  assert.equal(replies[0].payload.data.shipping_status, 'quote_pending');
  assert.equal(inserts.length, 1);
  // 第 16 位是 customer_id（游客为空），第 19 位是同意时间戳。
  assert.equal(inserts[0][15], null);
  assert.equal(new Date(inserts[0][18]).toISOString(), consentAt);
});

test('下单必须带同意凭据：缺时间戳 428，过期/未来时间也拒绝，签名 Cookie 可替代', async () => {
  const run = async (body, cookie) => {
    const { router, replies } = routerFor(body, async (sql, params) => {
      if (sql.includes('FROM shop_orders WHERE idempotency_key')) return { rows: [] };
      if (sql.includes('FROM shop_orders WHERE status')) return { rows: [] };
      if (sql.includes('FROM shop_settings')) return { rows: [{ shipping_mode: 'flat', checkout_enabled: true, currency: 'USD', payment_provider: 'manual', payment_methods: ['manual'] }] };
      if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: '附件', price_cents: 9900, currency: 'USD', image_url: '', stock: 5, allow_backorder: false }] };
      if (sql.startsWith('UPDATE shop_products SET stock=stock-')) return { rows: [] };
      if (sql.startsWith('INSERT INTO shop_orders')) return { rows: [{ id: params[0], order_number: params[1], items: [], shipping_status: 'included', payment_status: 'unpaid', payment_provider: 'manual', total_cents: params[10], status: 'pending' }] };
      if (sql.startsWith('INSERT INTO shop_order_events')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const headers = cookie ? { cookie } : {};
    await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers, socket: { remoteAddress: 'consent' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/shop/orders');
    return replies[0]?.status;
  };
  const bare = { ...validOrder(), consent_analytics_at: undefined };
  assert.equal(await run(bare), 428);
  assert.equal(await run({ ...bare, consent_analytics_at: new Date(Date.now() - 13 * 3600_000).toISOString() }), 428);
  assert.equal(await run({ ...bare, consent_analytics_at: new Date(Date.now() + 30 * 60_000).toISOString() }), 428);

  const cookie = `hm_consent=${signConsent('vis_test')}`;
  assert.notEqual(await run(bare, cookie), 428, '签名 Cookie 应视为已同意');
  assert.notEqual(await run(validOrder(), `hm_consent=${signConsent('vis_test')}x`), 428, '坏签名应退回时间戳判定');
  assert.equal(await run(bare, 'hm_consent=vis_x.123.bad'), 428);
});

test('同一购物车批次重复提交返回原单，换了批次号则算新单', async () => {
  const inserts = [];
  const body = { ...validOrder(), cart_nonce: 'batch-1' };
  const { router, replies } = routerFor(body, async (sql, params) => {
    if (sql.includes('FROM shop_orders WHERE idempotency_key')) return { rows: [] };
    if (sql.includes('FROM shop_orders WHERE status') && sql.includes('interval')) {
      return { rows: [{ id: 'order-1', order_number: 'HM1', items: [{ id: 'product-1', quantity: 1 }], total_cents: 9900, cart_nonce: 'batch-1', status: 'pending', payment_status: 'unpaid', payment_provider: 'manual', shipping_status: 'included' }] };
    }
    if (sql.startsWith('INSERT INTO shop_orders')) { inserts.push(params); throw new Error('should not insert'); }
    throw new Error(`unexpected query: ${sql}`);
  });
  await router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: {}, socket: { remoteAddress: 'dupe' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/shop/orders');
  assert.equal(replies[0].status, 200);
  assert.equal(replies[0].payload.data.order_number, 'HM1');
  assert.equal(replies[0].payload.data.deduplicated, true);
  assert.equal(inserts.length, 0);

  // 换批次号（用户确实又下一单同样的东西）→ 不合并
  const second = routerFor({ ...body, cart_nonce: 'batch-2', idempotency_key: 'test-order-2' }, async (sql, params) => {
    if (sql.includes('FROM shop_orders WHERE idempotency_key')) return { rows: [] };
    if (sql.includes('FROM shop_orders WHERE status')) return { rows: [{ id: 'order-1', order_number: 'HM1', items: [{ id: 'product-1', quantity: 1 }], total_cents: 9900, cart_nonce: 'batch-1', status: 'pending' }] };
    if (sql.includes('FROM shop_settings')) return { rows: [{ shipping_mode: 'flat', checkout_enabled: true, shipping_cents: 0 }] };
    if (sql.startsWith('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder')) return { rows: [{ id: 'product-1', sku: 'SKU-1', name: 'A', price_cents: 9900, currency: 'USD', image_url: '', stock: 5, allow_backorder: false }] };
    if (sql.startsWith('UPDATE shop_products SET stock=stock-')) return { rows: [] };
    if (sql.startsWith('INSERT INTO shop_orders')) { inserts.push(params); return { rows: [{ id: 'order-2', order_number: 'HM2', items: [], status: 'pending', payment_status: 'unpaid', payment_provider: 'manual', shipping_status: 'included', total_cents: 9900 }] }; }
    if (sql.startsWith('INSERT INTO shop_order_events')) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await second.router({ method: 'POST', url: '/site-admin-api/shop/orders', headers: {}, socket: { remoteAddress: 'dupe-2' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/shop/orders');
  assert.equal(second.replies[0].status, 201);
  assert.equal(inserts.length, 1);
});


test('商品级运费规则支持地区覆盖和默认回退校验', () => {
  const base = { sku: 'SKU-SHIP', slug: 'ship-test', name: 'Shipping test', price_cents: 100, stock: 1, active: false };
  const parsed = productInput({ ...base, shipping_rules: { mode: 'collect', zones: [{ countries: ['US', 'us'], mode: 'flat', amount_cents: 3000 }] } });
  assert.equal(parsed.shipping_rules.mode, 'collect');
  assert.deepEqual(parsed.shipping_rules.zones[0].countries, ['US']);
  assert.equal(parsed.shipping_rules.zones[0].amount_cents, 3000);
  assert.throws(() => productInput({ ...base, shipping_rules: { mode: 'collect', zones: [{ countries: [], mode: 'flat', amount_cents: 1 }] } }), { status: 400 });
});

test('公开运费报价按商品地区规则计算并可回退到付', async () => {
  const replies = [];
  const router = createCommerceRouter({
    store: {
      query: async (sql) => {
        if (sql.includes('FROM shop_settings')) return { rows: [{ shipping_mode: 'quote', shipping_cents: 0, shipping_zones: [], currency: 'USD' }] };
        if (sql.includes('FROM shop_products')) return { rows: [
          { id: 'p1', sku: 'P1', name: 'P1', shipping_rules: { mode: 'collect', zones: [{ countries: ['US'], mode: 'flat', amount_cents: 3000, active: true }] } },
          { id: 'p2', sku: 'P2', name: 'P2', shipping_rules: { mode: 'collect', zones: [] } }
        ] };
        throw new Error(`unexpected query: ${sql}`);
      }
    },
    bodyJson: async () => ({ country: 'United States', items: [{ id: 'p1', quantity: 1 }, { id: 'p2', quantity: 1 }] }),
    json: (_res, status, payload) => replies.push({ status, payload }),
    verifySession: () => true
  });
  await router({ method: 'POST', url: '/site-admin-api/shop/shipping-quote', headers: {}, socket: { remoteAddress: 'test' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/shop/shipping-quote');
  assert.equal(replies[0].status, 200);
  assert.equal(replies[0].payload.data.shipping_status, 'collect');
  assert.equal(replies[0].payload.data.shipping_cents, 3000);
});


test('后台部分退款按 Stripe 金额累计并标记 partially_refunded', async () => {
  const replies = [];
  let stripeAmount = '';
  const currentOrder = { id: 'order-1', order_number: 'HM1', total_cents: 10000, refunded_cents: 0, payment_status: 'paid', payment_provider: 'stripe', provider_payment_id: 'pi_test', customer_id: null, phone: '13800000000' };
  const router = createCommerceRouter({
    store: {
      query: async (sql) => {
        if (sql.startsWith('SELECT * FROM shop_orders WHERE id=')) return { rows: [{ ...currentOrder }] };
        throw new Error(`unexpected query: ${sql}`);
      },
      withTransaction: async (run) => {
        const client = { query: async (sql, params) => {
          if (sql.includes('FOR UPDATE')) return { rows: [{ ...currentOrder }] };
          if (sql.startsWith("UPDATE shop_orders SET payment_status=$2")) return { rows: [{ ...currentOrder, payment_status: params[1], refunded_cents: params[2] }] };
          if (sql.startsWith("SELECT id FROM shop_refund_requests")) return { rows: [] };
          if (sql.startsWith('INSERT INTO shop_refund_requests')) return { rows: [] };
          if (sql.startsWith('INSERT INTO shop_order_events')) return { rows: [] };
          throw new Error(`unexpected transaction query: ${sql}`);
        } };
        return run(client);
      }
    },
    bodyJson: async () => ({ email: 'admin@example.com', password: 'secret', amount_cents: 4000 }),
    json: (_res, status, payload) => replies.push({ status, payload }),
    verifySession: () => true,
    verifyAdminPassword: async () => true,
    auditEvent: async () => {}
  });
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_partial';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    stripeAmount = new URLSearchParams(String(options.body || '')).get('amount') || '';
    return { ok: true, json: async () => ({ id: 're_partial_1', amount: 4000 }) };
  };
  try {
    await router({ method: 'POST', url: '/site-admin-api/commerce/orders/order-1/refund', headers: {}, socket: { remoteAddress: 'test' } }, { setHeader() {}, writeHead() {}, end() {} }, '/site-admin-api/commerce/orders/order-1/refund');
  } finally {
    globalThis.fetch = previousFetch;
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previous;
  }
  assert.equal(stripeAmount, '4000');
  assert.equal(replies[0].status, 200);
  assert.equal(replies[0].payload.data.refunded_cents, 4000);
  assert.equal(replies[0].payload.data.payment_status, 'partially_refunded');
});
