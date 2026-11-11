import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLanguagePackRouter, normalizeEntries } from './language-pack-router.mjs';

function harness({ session = true } = {}) {
  const settings = new Map();
  const replies = [];
  const rebuilds = [];
  const platformStore = {
    readRuntimeSetting: async (key) => settings.get(key) || null,
    saveRuntimeSetting: async (key, value) => { settings.set(key, value); }
  };
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
  fs.mkdirSync(path.join(rootDir, 'frontend/src/i18n/dictionaries'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'frontend/src/i18n/dictionaries/ar.json'), JSON.stringify({ Hello: 'مرحبا' }));
  const router = createLanguagePackRouter({
    bodyJson: async () => ({}),
    json: (_res, status, payload) => replies.push({ status, payload }),
    verifySession: () => session,
    platformStore,
    auditEvent: async () => {},
    requestRebuild: (source) => rebuilds.push(source),
    translationService: { translateKeyValues: async (_locale, entries) => Object.fromEntries(Object.keys(entries).map((key) => [key, `AI:${key}`])) },
    rootDir,
    logger: { error: () => {} }
  });
  return { router, replies, rebuilds, settings };
}

const call = (router, method, url, body) => {
  const pathname = String(url).split('?')[0];
  const req = { method, url, headers: {}, body: JSON.stringify(body || {}) };
  return router.handle(req, {}, pathname);
};

test('语言包上传后公开端点只在 pack 模式下返回条目', async () => {
  const { router, replies, rebuilds } = harness();
  // 初始：无语言包
  await call(router, 'GET', '/site-admin-api/public-language-pack?locale=ar');
  assert.equal(replies.at(-1).payload.data.mode, 'pack');
  assert.deepEqual(replies.at(-1).payload.data.entries, {});

  // 上传条目（body 直接是 map）
  const req = { method: 'PUT', url: '/site-admin-api/language-packs/ar', headers: {} };
  const origBodyJson = router;
  // 用带 entries 的 body 走路由
  const router2 = createLanguagePackRouter({
    bodyJson: async () => ({ entries: { Hello: 'أهلا' } }),
    json: (_r, status, payload) => replies.push({ status, payload }),
    verifySession: () => true,
    platformStore: { readRuntimeSetting: async () => null, saveRuntimeSetting: async () => {} },
    auditEvent: async () => {},
    requestRebuild: (s) => rebuilds.push(s),
    translationService: null,
    rootDir: os.tmpdir(),
    logger: { error: () => {} }
  });
  await router2.handle(req, {}, '/site-admin-api/language-packs/ar');
  assert.equal(replies.at(-1).status, 200);
  const arAfterUpload = replies.at(-1).payload.data.locales.find((item) => item.locale === 'ar');
  assert.equal(arAfterUpload.count, 1);
  assert.ok(rebuilds.includes('language-pack-upload-ar'));
});

test('未登录拒绝；ai 模式不注入语言包', async () => {
  const anon = harness({ session: false });
  await call(anon.router, 'GET', '/site-admin-api/language-packs');
  assert.equal(anon.replies.at(-1).status, 401);

  const { router, replies, settings } = harness();
  settings.set('language-pack', { config: { modes: { ar: 'ai' }, packs: { ar: { entries: { Hello: 'أهلا' }, updatedAt: 'x' } } }, secrets: {} });
  await call(router, 'GET', '/site-admin-api/public-language-pack?locale=ar');
  assert.equal(replies.at(-1).payload.data.mode, 'ai');
  assert.deepEqual(replies.at(-1).payload.data.entries, {});
});

test('seed 读内置词典；ai-fill 只补缺失条目', async () => {
  const { router, replies, rebuilds } = harness();
  await call(router, 'POST', '/site-admin-api/language-packs/ar/seed');
  const arAfterSeed = replies.at(-1).payload.data.locales.find((item) => item.locale === 'ar');
  assert.equal(arAfterSeed.count, 1);

  const fill = createLanguagePackRouter({
    bodyJson: async () => ({ entries: { Hello: 'مرحبا', Bye: 'مع السلامة' } }),
    json: (_r, status, payload) => replies.push({ status, payload }),
    verifySession: () => true,
    platformStore: {
      readRuntimeSetting: async () => ({ config: { packs: { ar: { entries: { Hello: 'مرحبا' } } }, modes: {} }, secrets: {} }),
      saveRuntimeSetting: async () => {}
    },
    auditEvent: async () => {},
    requestRebuild: (s) => rebuilds.push(s),
    translationService: { translateKeyValues: async (_locale, entries) => Object.fromEntries(Object.keys(entries).map((key) => [key, `AI:${key}`])) },
    rootDir: os.tmpdir(),
    logger: { error: () => {} }
  });
  await fill.handle({ method: 'POST', url: '', headers: {} }, {}, '/site-admin-api/language-packs/ar/ai-fill');
  assert.equal(replies.at(-1).payload.data.missing, 1);
  assert.equal(replies.at(-1).payload.data.filled, 1);
});

test('normalizeEntries 拒绝非字符串与超限', () => {
  assert.deepEqual(normalizeEntries({ a: ' b ' }), { a: 'b' });
  assert.throws(() => normalizeEntries({ a: 1 }), /必须是字符串/);
  assert.throws(() => normalizeEntries({ a: 'x'.repeat(5000) }), /过长/);
  assert.throws(() => normalizeEntries([1, 2]), /对象/);
});
