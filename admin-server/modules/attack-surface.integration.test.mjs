import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * 攻击者视角复查时修掉的问题，逐条钉住：
 * - 超大请求体以前是「连接被重置」，现在必须回 413 + 说明；
 * - X-Forwarded-For 以前取最左段（客户端可伪造），限流一换头就绕过；
 * - visitor_id / session_id 客户端可塞任意字符，会污染 Cookie 与删除令牌；
 * - 咨询单先限流后判重，重试/连点也吃额度，共用出口 IP 的办公网 5 条就全 429；
 * - 留言里的点号会让同意 Cookie 解析错位（`a.b.c.d` 切成四段）。
 */

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

async function startServer() {
  const root = process.cwd();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'astreva-harden-data-'));
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'astreva-harden-upload-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  const server = spawn('node', ['admin-server/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      CMS_STORE_DRIVER: 'json',
      ALLOW_LEGACY_STORAGE_FOR_TESTS: 'true',
      ADMIN_2FA_SESSION_SECRET: 'hardening-test-secret',
      ADMIN_TRUST_PROXY: 'true',
      ADMIN_CORS_ALLOWED_ORIGINS: ORIGIN,
      ADMIN_DATA_DIR: dataDir,
      ADMIN_UPLOAD_DIR: uploadDir,
      ADMIN_LEAD_RATE_MAX: '3',
      ADMIN_LEAD_HARD_RATE_MAX: '6',
      SITE_CONTENT_SEED_FILE: path.join(root, 'admin-server', 'seed', 'site-content.json'),
      FRONTEND_REBUILD_WEBHOOK_URL: 'http://127.0.0.1:1/rebuild'
    },
    stdio: 'ignore'
  });
  return { base: `http://127.0.0.1:${port}`, server };
}

function leadBody(marker) {
  return JSON.stringify({ name: `Probe ${marker}`, email: `${marker}@example.com`, message: `message ${marker}` });
}

test('超大请求体回 413 而不是连接重置', { timeout: 40000 }, async (t) => {
  const { base, server } = await startServer();
  try {
    await waitFor(base);
    // leads 的上限是 64KB：塞 300KB 进去，客户端必须拿到正常的 413 + 提示。
    const huge = JSON.stringify({ name: 'big', email: 'big@example.com', message: 'a'.repeat(300 * 1024) });
    const response = await fetch(`${base}/site-admin-api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: huge
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error.message, /太大/);

    // 连接没被打断：紧接着的正常请求照常工作。
    const after = await fetch(`${base}/site-admin-api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: leadBody('after-big')
    });
    assert.equal(after.status, 201);

    // 坏 JSON 是 400 而不是 500。
    const broken = await fetch(`${base}/site-admin-api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: '{"name":'
    });
    assert.equal(broken.status, 400);
  } finally {
    server.kill();
  }
});

test('伪造 X-Forwarded-For 左端绕不过咨询单限流', { timeout: 40000 }, async (t) => {
  const { base, server } = await startServer();
  try {
    await waitFor(base);
    const post = (id, xff) => fetch(`${base}/site-admin-api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': xff },
      body: leadBody(id)
    });
    // 真实客户端固定在最右（代理追加），左边每次换一个假地址。
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await post(`spoof-${i}`, `10.0.0.${i}, 1.1.1.1`)).status);
    assert.deepEqual(statuses.slice(0, 3), [201, 201, 201], '额度内应当都成功');
    assert.equal(statuses[3], 429, '换掉伪造的左端以后仍然要消耗同一个额度');

    // 限流打满以后，重复提交同一份内容仍然返回原单（200 duplicate），不是 429。
    const again = await post('spoof-0', '172.16.0.9, 1.1.1.1');
    assert.equal(again.status, 200);
    assert.equal((await again.json()).meta.duplicate, true);
  } finally {
    server.kill();
  }
});

test('客户端标识里的怪字符不会污染同意 Cookie 与删除令牌', { timeout: 40000 }, async (t) => {
  const { base, server } = await startServer();
  try {
    await waitFor(base);
    const beacon = await fetch(`${base}/site-admin-api/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ path: '/pricing', visitor_id: 'vis_a b;c d', session_id: 'ses 1;2' })
    });
    assert.equal(beacon.status, 202);
    const setCookie = beacon.headers.get('set-cookie') || '';
    assert.match(setCookie, /hm_consent=vis_abcd\./);
    const consentCookie = setCookie.split(';')[0];
    const token = (await beacon.json()).forget_token;
    assert.match(token, /^[0-9a-f]{32}$/);

    // Cookie 里带点号的 visitor_id 以前会被切成四段直接失效：确认签名仍然成立（不被 428 打回）。
    const order = await fetch(`${base}/site-admin-api/shop/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: consentCookie },
      body: JSON.stringify({
        customer: { name: 'Dot Buyer', email: 'dot@example.com', phone: '+86 138 0000 0200', city: 'Qingzhou', line1: 'No.2 Road', country: 'China' },
        shipping_address: { city: 'Qingzhou', line1: 'No.2 Road', country: 'China' },
        items: [{ id: 'hm-mm38', quantity: 1 }],
        expected_total_cents: 1,
        idempotency_key: `dot-${Math.random()}`
      })
    });
    assert.notEqual(order.status, 428, '带点号的 visitor_id 不能让同意凭据失效');

    // 删除令牌能真的删掉这批访问记录。
    const forget = await fetch(`${base}/site-admin-api/analytics/forget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ visitor_id: 'vis_abcd', token })
    });
    assert.equal(forget.status, 200);
  } finally {
    server.kill();
  }
});

test('未知来源、null 来源都进不了公开写接口', { timeout: 40000 }, async (t) => {
  const { base, server } = await startServer();
  try {
    await waitFor(base);
    for (const origin of ['https://evil.example', 'null', `${ORIGIN}.evil.com`]) {
      const response = await fetch(`${base}/site-admin-api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: leadBody(`origin-${origin.length}`)
      });
      assert.equal(response.status, 403, `${origin} 应当被拒`);
    }
    // 后缀命中不能靠前缀匹配混过去：evil.example.com 不是 example.com 的子域。
    const suffix = await fetch(`${base}/site-admin-api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com.evil.example' },
      body: leadBody('suffix')
    });
    assert.equal(suffix.status, 403);
  } finally {
    server.kill();
  }
});
