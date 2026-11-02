import assert from 'node:assert/strict';
import bcrypt from "bcryptjs";
import test from 'node:test';
import { createCustomerRouter } from './customer-router.mjs';

function routerFor({ rows = [] } = {}) {
  const replies = [];
  const router = createCustomerRouter({
    store: { query: async () => ({ rows }), readRuntimeSetting: async () => null },
    bodyJson: async () => ({}),
    json: (_res, status, payload) => replies.push({ status, payload }),
    applyPublicCors: () => true,
    siteOrigin: 'http://127.0.0.1:4331',
    verifySession: () => null
  });
  return { router, replies };
}

test('匿名客户 session 状态返回 200 和 null，前台访客购物车无需处理 401', async () => {
  const { router, replies } = routerFor();
  const handled = await router({ method: 'GET', url: '/site-admin-api/customer/session', headers: {} }, { setHeader() {} }, '/site-admin-api/customer/session');
  assert.equal(handled, true);
  assert.deepEqual(replies, [{ status: 200, payload: { data: null } }]);
});

test('客户 session 状态只返回当前已登录客户的公开资料', async () => {
  const customer = { id: 'customer-1', email: 'buyer@example.com', full_name: 'Buyer', phone: '+1 555 0100', legal_name: '', verification_status: 'unverified', created_at: '2026-01-01T00:00:00.000Z', password_hash: 'must-not-leak' };
  const { router, replies } = routerFor({ rows: [customer] });
  const handled = await router({ method: 'GET', url: '/site-admin-api/customer/session', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/session');
  assert.equal(handled, true);
  assert.equal(replies[0].status, 200);
  assert.deepEqual(replies[0].payload.data, {
    id: customer.id, email: customer.email, full_name: customer.full_name, phone: customer.phone,
    legal_name: '', verification_status: 'unverified', created_at: customer.created_at
  });
  assert.equal('password_hash' in replies[0].payload.data, false);
});

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(String(url), init);
  return () => { globalThis.fetch = original; };
}

const stripeCustomer = { id: 'customer-1', email: 'buyer@example.com', full_name: 'Buyer', phone: '', legal_name: '', verification_status: 'unverified', payment_customer_id: 'cus_123' };

test('付款方式列表返回品牌、后四位、有效期与默认卡标记', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  const restore = stubFetch(async (url) => {
    if (url.includes('/v1/payment_methods?')) return new Response(JSON.stringify({ data: [{ id: 'pm_visa', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028, wallet: null } }] }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cus_123', invoice_settings: { default_payment_method: 'pm_visa' } }), { status: 200 });
  });
  try {
    const { router, replies } = routerFor({ rows: [stripeCustomer] });
    const handled = await router({ method: 'GET', url: '/site-admin-api/customer/payment-methods', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/payment-methods');
    assert.equal(handled, true);
    assert.equal(replies[0].status, 200);
    assert.deepEqual(replies[0].payload.data, [{ id: 'pm_visa', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028, wallet: null, is_default: true }]);
  } finally { restore(); delete process.env.STRIPE_SECRET_KEY; }
});

test('还没在 Stripe 建客户时付款方式列表为空且不调用 Stripe', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  let stripeCalls = 0;
  const restore = stubFetch(async () => { stripeCalls += 1; return new Response('{}', { status: 200 }); });
  try {
    const { router, replies } = routerFor({ rows: [{ ...stripeCustomer, payment_customer_id: null }] });
    await router({ method: 'GET', url: '/site-admin-api/customer/payment-methods', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/payment-methods');
    assert.deepEqual(replies[0], { status: 200, payload: { data: [] } });
    assert.equal(stripeCalls, 0);
  } finally { restore(); delete process.env.STRIPE_SECRET_KEY; }
});

test('删除付款方式会校验归属并调用 Stripe detach', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  const calls = [];
  const restore = stubFetch(async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    if (url.endsWith('/v1/payment_methods/pm_visa')) return new Response(JSON.stringify({ id: 'pm_visa', customer: 'cus_123' }), { status: 200 });
    if (url.endsWith('/v1/payment_methods/pm_visa/detach')) return new Response(JSON.stringify({ id: 'pm_visa' }), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  try {
    const { router, replies } = routerFor({ rows: [stripeCustomer] });
    const handled = await router({ method: 'DELETE', url: '/site-admin-api/customer/payment-methods/pm_visa', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/payment-methods/pm_visa');
    assert.equal(handled, true);
    assert.deepEqual(replies[0], { status: 200, payload: { data: { ok: true } } });
    assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST']);
  } finally { restore(); delete process.env.STRIPE_SECRET_KEY; }
});

test('删除别人的付款方式返回 404 且不会 detach', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  const calls = [];
  const restore = stubFetch(async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    return new Response(JSON.stringify({ id: 'pm_other', customer: 'cus_other' }), { status: 200 });
  });
  try {
    const { router, replies } = routerFor({ rows: [stripeCustomer] });
    await router({ method: 'DELETE', url: '/site-admin-api/customer/payment-methods/pm_other', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/payment-methods/pm_other');
    assert.equal(replies[0].status, 404);
    assert.equal(calls.some((call) => call.method === 'POST'), false);
  } finally { restore(); delete process.env.STRIPE_SECRET_KEY; }
});

test('未配置 Stripe 时付款方式列表返回空数组而不是错误', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const { router, replies } = routerFor({ rows: [stripeCustomer] });
  await router({ method: 'GET', url: '/site-admin-api/customer/payment-methods', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/payment-methods');
  assert.deepEqual(replies[0], { status: 200, payload: { data: [] } });
});

function profileRouter({ customer, body = {}, verification = null, taken = [] }) {
  const replies = []; const queries = [];
  const router = createCustomerRouter({
    store: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('shop_customer_sessions')) return { rows: [customer] };
        if (sql.includes('lower(email)=lower($1) AND id<>')) return { rows: taken };
        return { rows: [customer] };
      },
      readRuntimeSetting: async () => null
    },
    bodyJson: async () => body,
    json: (_res, status, payload) => replies.push({ status, payload }),
    applyPublicCors: () => true,
    siteOrigin: 'http://127.0.0.1:4331',
    verifySession: () => null,
    verification
  });
  return { router, replies, queries };
}
const bcryptHash = await bcrypt.hash('old-password-123', 12);

test('修改资料时校验当前密码，通过后写入新密码哈希', async () => {
  const customer = { id: 'customer-1', email: 'buyer@example.com', password_hash: bcryptHash, full_name: 'Buyer', phone: '', legal_name: '', verification_status: 'unverified' };
  const wrong = profileRouter({ customer, body: { full_name: 'Buyer One', phone: '+1 555', current_password: 'nope', new_password: 'new-password-123' } });
  await wrong.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(wrong.replies[0].status, 403);
  assert.equal(wrong.queries.some((entry) => entry.sql.startsWith('UPDATE shop_customers')), false);

  const right = profileRouter({ customer, body: { full_name: 'Buyer One', phone: '+1 555', current_password: 'old-password-123', new_password: 'new-password-123' } });
  await right.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(right.replies[0].status, 200);
  const update = right.queries.find((entry) => entry.sql.startsWith('UPDATE shop_customers'));
  assert.equal(await bcrypt.compare('new-password-123', update.params[4]), true);
});

test('改邮箱必须带上新邮箱的验证码，且不能和别的账户重复', async () => {
  const customer = { id: 'customer-1', email: 'buyer@example.com', password_hash: bcryptHash, full_name: 'Buyer', phone: '', legal_name: '', verification_status: 'unverified' };
  const verification = { verify: async () => ({ ok: false, reason: '验证码不正确。' }) };
  const bad = profileRouter({ customer, verification, body: { full_name: 'Buyer', phone: '', email: 'new@example.com', email_code: '000000' } });
  await bad.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(bad.replies[0].status, 400);
  assert.equal(bad.queries.some((entry) => entry.sql.startsWith('UPDATE shop_customers')), false);

  const ok = profileRouter({ customer, verification: { verify: async () => ({ ok: true }) }, body: { full_name: 'Buyer', phone: '', email: 'new@example.com', email_code: '123456' } });
  await ok.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(ok.replies[0].status, 200);
  const update = ok.queries.find((entry) => entry.sql.startsWith('UPDATE shop_customers'));
  assert.equal(update.params[3], 'new@example.com');

  const taken = profileRouter({ customer, verification: { verify: async () => ({ ok: true }) }, taken: [{ id: 'other' }], body: { full_name: 'Buyer', phone: '', email: 'new@example.com', email_code: '123456' } });
  await taken.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(taken.replies[0].status, 409);
});

test('改密码可以用当前邮箱收到的验证码确认', async () => {
  const customer = { id: 'customer-1', email: 'buyer@example.com', password_hash: bcryptHash, full_name: 'Buyer', phone: '', legal_name: '', verification_status: 'unverified' };
  const verification = { verify: async (_email, code) => (code === '123456' ? { ok: true } : { ok: false, reason: '验证码不正确。' }) };
  const good = profileRouter({ customer, verification, body: { full_name: 'Buyer', phone: '', new_password: 'new-password-123', password_code: '123456' } });
  await good.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(good.replies[0].status, 200);
  const update = good.queries.find((entry) => entry.sql.startsWith('UPDATE shop_customers'));
  assert.equal(await bcrypt.compare('new-password-123', update.params[4]), true);

  const bad = profileRouter({ customer, verification, body: { full_name: 'Buyer', phone: '', new_password: 'new-password-123', password_code: '000000' } });
  await bad.router({ method: 'PATCH', url: '/site-admin-api/customer/me', headers: { cookie: 'hongmeng_customer_session=active-session' } }, { setHeader() {} }, '/site-admin-api/customer/me');
  assert.equal(bad.replies[0].status, 400);
});

test('账户接口的 CORS 预检允许 PATCH，资料弹窗才能保存', async () => {
  const headers = {};
  const router = createCustomerRouter({
    store: { query: async () => ({ rows: [] }), readRuntimeSetting: async () => null },
    bodyJson: async () => ({}),
    json: () => {},
    applyPublicCors: () => true,
    siteOrigin: 'http://127.0.0.1:4331',
    verifySession: () => null
  });
  const res = { setHeader: (key, value) => { headers[key] = value; }, writeHead: () => {}, end: () => {} };
  const handled = await router({ method: 'OPTIONS', url: '/site-admin-api/customer/me', headers: { origin: 'http://127.0.0.1:4331' } }, res, '/site-admin-api/customer/me');
  assert.equal(handled, true);
  assert.match(String(headers['Access-Control-Allow-Methods']), /PATCH/);
});

function setup({ existing = false, body = {}, claimedRows = 0, verifyResult = { ok: true } } = {}) {
  const replies = [];
  const queries = [];
  const verifyCalls = [];
  const router = createCustomerRouter({
    store: {
      query: async (sql, params = []) => {
        queries.push(sql.replace(/\s+/g, ' ').slice(0, 90));
        if (sql.includes('FROM shop_customers WHERE lower(email)')) return { rows: existing ? [{ id: 'customer-x' }] : [] };
        if (sql.startsWith('INSERT INTO shop_customers')) return { rows: [{ id: 'customer-1', email: params[1], full_name: params[3], phone: '', legal_name: '', verification_status: 'verified', created_at: '2026-01-01T00:00:00.000Z' }] };
        if (sql.includes('UPDATE shop_orders SET customer_id')) return { rows: Array.from({ length: claimedRows }, (_, index) => ({ id: `order-${index}` })) };
        return { rows: [] };
      },
      readRuntimeSetting: async () => null
    },
    bodyJson: async () => body,
    json: (_res, status, payload) => replies.push({ status, payload }),
    applyPublicCors: () => true,
    siteOrigin: 'http://127.0.0.1:4331',
    verification: {
      verify: async (email, code) => {
        verifyCalls.push(code);
        if (!code) return { ok: false, reason: '验证码应为 6 位数字。' };
        return verifyResult;
      }
    },
    verifySession: () => null
  });
  const call = (path, ip = '1.1.1.1') => router({ method: 'POST', url: path, headers: {}, socket: { remoteAddress: ip } }, { setHeader() {} }, path);
  return { call, replies, queries, verifyCalls };
}

const registerBody = { email: 'new@example.com', password: 'password-12345', full_name: 'New Buyer', code: '123456' };

test('注册必须带邮箱验证码，已有账户直接 409 且不消耗验证码', async () => {
  const noCode = setup({ body: { ...registerBody, code: '' } });
  await noCode.call('/site-admin-api/customer/register');
  assert.equal(noCode.replies[0].status, 400);
  assert.equal(noCode.verifyCalls.length, 1, '空验证码也要交给校验');
  assert.equal(noCode.queries.some((sql) => sql.startsWith('INSERT INTO shop_customers')), false);

  const taken = setup({ existing: true, body: registerBody });
  await taken.call('/site-admin-api/customer/register', '1.1.1.3');
  assert.equal(taken.replies[0].status, 409);
  assert.deepEqual(taken.verifyCalls, [], '先判重复邮箱，别白烧一条验证码');
});

test('验证码正确时注册成功并标记邮箱已验证，随后认领同邮箱游客单', async () => {
  const { call, replies, queries } = setup({ body: registerBody });
  await call('/site-admin-api/customer/register', '1.1.1.4');
  assert.equal(replies[0].status, 201);
  assert.equal(replies[0].payload.data.verification_status, 'verified');
  assert.ok(queries.some((sql) => sql.includes('INSERT INTO shop_customers') && sql.includes('verification_status')), '插入时应写 verification_status');
  assert.ok(queries.some((sql) => sql.includes('UPDATE shop_orders SET customer_id')), '注册后要认领历史游客单');
});

test('保存到账户：邮箱已有账户 409，否则创建账户并回报认领数量', async () => {
  const existing = setup({ existing: true, body: { ...registerBody, code: '123456' } });
  await existing.call('/site-admin-api/customer/claim', '1.1.1.5');
  assert.equal(existing.replies[0].status, 409);

  const fresh = setup({ body: { ...registerBody, code: '123456', full_name: '' }, claimedRows: 2 });
  await fresh.call('/site-admin-api/customer/claim', '1.1.1.6');
  assert.equal(fresh.replies[0].status, 201);
  assert.equal(fresh.replies[0].payload.data.claimed_orders, 2);
  assert.equal(fresh.replies[0].payload.data.full_name, 'new', '没填姓名时用邮箱前缀兜底');
});
