import assert from 'node:assert/strict';
import test from 'node:test';
import { createStorefrontTranslationService } from './storefront-translation-service.mjs';

function fakeStore() {
  const source = {
    products: [{ id: 'p-1', sku: 'HM-1', slug: 'machine-1', category: '粉碎属具', name: '小型粉碎机', summary: '用于清理灌木', description: '产品介绍', highlights: ['结构紧凑'], specifications: [{ label: '工作宽度', value: '710 毫米' }], faqs: [{ question: '如何适配？', answer: '核对液压流量' }], image_url: '/machine.webp', gallery: [], videos: [], price_cents: 549900, currency: 'USD', stock: 0, allow_backorder: true, available: true, featured: true }],
    storefront: { home: { title: '厂家直供设备属具' }, navigation: { shopLabel: '选购' }, heroImage: '/assets/hero.webp' },
    policies: { privacy_policy: '隐私政策', cookie_policy: '', terms_policy: '', shipping_policy: '', returns_policy: '' }
  };
  const saved = new Map();
  return {
    source,
    async query(sql) {
      if (sql.includes('FROM shop_products')) return { rows: source.products.map((product) => ({ ...product })) };
      return { rows: [{ storefront_content: structuredClone(source.storefront), privacy_policy: source.policies.privacy_policy, cookie_policy: '', terms_policy: '', shipping_policy: '', returns_policy: '' }] };
    },
    async readRuntimeSetting(key) { return saved.has(key) ? structuredClone(saved.get(key)) : null; },
    async saveRuntimeSetting(key, value) { const record = structuredClone({ ...value, updatedAt: new Date().toISOString() }); saved.set(key, record); return structuredClone(record); }
  };
}

test('商城译文按内容修订持久保存，商品图像和价格等非文案字段不会被改动', async () => {
  const store = fakeStore();
  const translationService = {
    publicSettings: async () => ({ enabled: true, apiKeyConfigured: true, model: 'test', batchSize: 40 }),
    generateJson: async (prompt) => JSON.parse(prompt.split('\n').at(-1)).map((entry) => ({ id: entry.id, text: `EN:${entry.text}` }))
  };
  const service = createStorefrontTranslationService({ store, translationService, logger: { warn() {} } });
  const first = await service.publicContent('en');
  assert.equal(first.meta.status, 'pending');

  const deadline = Date.now() + 1500;
  let translated;
  while (Date.now() < deadline) {
    translated = await service.publicContent('en');
    if (translated.meta.status === 'ready') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(translated.meta.status, 'ready');
  assert.equal(translated.content.products[0].name, 'EN:小型粉碎机');
  assert.equal(translated.content.products[0].specifications[0].label, 'EN:工作宽度');
  assert.equal(translated.content.products[0].image_url, undefined);
  assert.equal(translated.content.storefront.heroImage, '/assets/hero.webp');
  assert.equal(translated.content.policies.privacy_policy, 'EN:隐私政策');
  assert.equal((await service.publicContent('zh-CN')).content.products[0].name, '小型粉碎机');
  assert.equal((await service.status()).status, 'ready');

  store.source.storefront.home.title = '更新后的页面标题';
  assert.equal((await service.status()).status, 'stale');
});

test('已有英文商城源内容会生成并持久保存中文页面译文', async () => {
  const store = fakeStore();
  store.source.products[0] = {
    ...store.source.products[0],
    category: 'Drum Mulchers', name: 'MM38 Mini Skid Steer Mulcher',
    summary: 'Compact drum attachment for brush clearing', description: 'Check hydraulic flow before ordering.',
    highlights: ['Working width', 'Confirm fitment before purchase'],
    specifications: [{ label: 'Working width', value: '710 mm (28.0 in)' }],
    faqs: [{ question: 'Does MM38 fit every mini skid steer?', answer: 'Compatibility depends on hydraulic flow and mount.' }]
  };
  store.source.storefront.home.title = 'Tools built for the work ahead.';
  const translationService = {
    publicSettings: async () => ({ enabled: true, apiKeyConfigured: true, model: 'test', batchSize: 40 }),
    generateJson: async (prompt) => JSON.parse(prompt.split('\n').at(-1)).map((entry) => ({ id: entry.id, text: `ZH:${entry.text}` }))
  };
  const service = createStorefrontTranslationService({ store, translationService, logger: { warn() {} } });
  let translated = await service.publicContent('zh-CN');
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && translated.meta.status !== 'ready') {
    await new Promise((resolve) => setTimeout(resolve, 5));
    translated = await service.publicContent('zh-CN');
  }
  assert.equal(translated.meta.status, 'ready');
  assert.equal(translated.content.products[0].name, 'ZH:MM38 Mini Skid Steer Mulcher');
  assert.equal(translated.content.products[0].specifications[0].label, 'ZH:Working width');
  assert.equal(translated.content.products[0].specifications[0].value, '710 mm (28.0 in)');
  assert.equal(translated.content.storefront.home.title, 'ZH:Tools built for the work ahead.');
  assert.equal(store.source.products[0].name, 'MM38 Mini Skid Steer Mulcher');
  assert.equal((await service.status('zh-CN')).status, 'ready');
});

test('阿拉伯语商城译文独立生成并按语言保存', async () => {
  const store = fakeStore();
  const translationService = {
    publicSettings: async () => ({ enabled: true, apiKeyConfigured: true, model: 'test', batchSize: 40 }),
    generateJson: async (prompt) => JSON.parse(prompt.split('\n').at(-1)).map((entry) => ({ id: entry.id, text: `AR:${entry.text}` }))
  };
  const service = createStorefrontTranslationService({ store, translationService, logger: { warn() {} } });
  let translated = await service.publicContent('ar');
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && translated.meta.status !== 'ready') {
    await new Promise((resolve) => setTimeout(resolve, 5));
    translated = await service.publicContent('ar');
  }
  assert.equal(translated.meta.status, 'ready');
  assert.equal(translated.content.products[0].name, 'AR:小型粉碎机');
  assert.equal(translated.content.storefront.home.title, 'AR:厂家直供设备属具');
  assert.equal((await service.statusAll()).ar.status, 'ready');
  assert.equal((await service.publicContent('zh-CN')).content.products[0].name, '小型粉碎机');

  store.source.products[0].name = 'MM38 Mini Skid Steer Mulcher';
  store.source.products[0].summary = 'Compact brush clearing attachment';
  store.source.storefront.home.title = 'Equipment for demanding work';
  translated = await service.publicContent('ar');
  const englishDeadline = Date.now() + 1500;
  while (Date.now() < englishDeadline && translated.meta.status !== 'ready') {
    await new Promise((resolve) => setTimeout(resolve, 5));
    translated = await service.publicContent('ar');
  }
  assert.equal(translated.meta.status, 'ready');
  assert.equal(translated.content.products[0].name, 'AR:MM38 Mini Skid Steer Mulcher');
});
