import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function waitFor(base, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`后台未能在 ${timeoutMs}ms 内启动`);
}

const ORIGIN = 'https://www.example.com';

test('同意凭据：埋点下发 HttpOnly 签名 Cookie，坏 Cookie 不 500，带凭据的跨域被允许', { timeout: 30000 }, async (t) => {
  const root = process.cwd();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'astreva-consent-data-'));
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'astreva-consent-upload-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  const server = spawn('node', ['admin-server/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      CMS_STORE_DRIVER: 'json',
      ALLOW_LEGACY_STORAGE_FOR_TESTS: 'true',
      ADMIN_2FA_SESSION_SECRET: 'consent-cookie-test-secret',
      ADMIN_TRUST_PROXY: 'true',
      ADMIN_CORS_ALLOWED_ORIGINS: ORIGIN,
      ADMIN_DATA_DIR: dataDir,
      ADMIN_UPLOAD_DIR: uploadDir,
      SITE_CONTENT_SEED_FILE: path.join(root, 'admin-server', 'seed', 'site-content.json'),
      FRONTEND_REBUILD_WEBHOOK_URL: 'http://127.0.0.1:1/rebuild'
    },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base);
    // 1) 预检必须允许携带凭据，否则浏览器根本不会保存同意 Cookie。
    const preflight = await fetch(`${base}/site-admin-api/analytics/visit`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);

    // 2) 带标识的上报才写同意 Cookie，且必须 HttpOnly + SameSite=Lax。
    const beacon = await fetch(`${base}/site-admin-api/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ path: '/cart', visitor_id: 'vis_consent_1', session_id: 'ses_1' })
    });
    assert.equal(beacon.status, 202);
    const setCookie = beacon.headers.get('set-cookie') || '';
    assert.match(setCookie, /hm_consent=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /Secure/i, '本地 http 不应加 Secure');
    const consentCookie = setCookie.split(';')[0];

    // 3) 匿名上报不写 Cookie（拿不到 visitor_id 也没法删）。
    const anonymous = await fetch(`${base}/site-admin-api/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ path: '/cart', anonymous: true })
    });
    assert.equal(anonymous.headers.get('set-cookie'), null);

    // 4) 坏掉的百分号编码不能让接口 500。
    const broken = await fetch(`${base}/site-admin-api/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: 'hm_consent=%zz; astreva_admin_session=%zz' },
      body: JSON.stringify({ path: '/cart', visitor_id: 'vis_consent_2', session_id: 'ses_2' })
    });
    assert.equal(broken.status, 202);

    // 5) 下单：没有前端时间戳时，签名 Cookie 单独就能过同意闸。
    const orderBody = (key) => ({
      customer: { name: 'Consent Buyer', email: 'consent@example.com', phone: '+86 138 0000 0100', city: 'Qingzhou', line1: 'No.1 Road', country: 'China' },
      shipping_address: { city: 'Qingzhou', line1: 'No.1 Road', country: 'China' },
      items: [{ id: 'hm-mm38', quantity: 1 }],
      expected_total_cents: 1,
      idempotency_key: key
    });
    const postOrder = (headers) => fetch(`${base}/site-admin-api/shop/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: JSON.stringify(orderBody(`consent-${Math.random()}`))
    });
    assert.equal((await postOrder({})).status, 428, '没有凭据也没有时间戳必须拒绝');
    assert.notEqual((await postOrder({ Cookie: consentCookie })).status, 428, '签名 Cookie 应当被接受');
    assert.equal((await postOrder({ Cookie: `${consentCookie}x` })).status, 428, '坏签名不算数，没有时间戳就继续拒绝');
  } finally {
    server.kill();
  }
});
