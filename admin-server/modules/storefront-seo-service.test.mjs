import assert from 'node:assert/strict';
import test from 'node:test';
import { createStorefrontSeoService, STOREFRONT_SEO_PAGES } from './storefront-seo-service.mjs';

test('SEO 生成覆盖全部页面，并规范标题/描述/关键词长度', async () => {
  let prompt = '';
  const service = createStorefrontSeoService({
    aiService: {
      async generateJson(value) {
        prompt = value;
        return {
          pages: Object.fromEntries(
            STOREFRONT_SEO_PAGES.map((page) => [
              page.key,
              { title: ` ${page.label} 的 SEO 标题 `.repeat(3), description: `描述 ${page.label} `.repeat(30), keywords: '工程机械, 属具, 配件' }
            ])
          )
        };
      }
    }
  });
  const result = await service.generate({
    content: { brand: { name: '宏盟机械' }, home: { title: '工程机械属具', subtitle: '林业粉碎机' } },
    products: [{ name: 'MM38 碎木机', category: '属具' }],
    policies: { shipping_policy: '配送政策正文' }
  });
  assert.equal(Object.keys(result.pages).length, STOREFRONT_SEO_PAGES.length);
  assert.ok(result.pages.home.title.length <= 70);
  assert.ok(result.pages.home.description.length <= 180);
  assert.match(prompt, /页面资料/);
  assert.match(prompt, /MM38 碎木机/);
});

test('SEO 生成缺少某些页面时保留可用的已返回页面，不整批失败', async () => {
  const service = createStorefrontSeoService({
    aiService: {
      async generateJson() {
        return { pages: { home: { title: '只返回首页标题', description: '只返回首页描述', keywords: '首页, 测试' } } };
      }
    }
  });
  const result = await service.generate({ content: {} });
  assert.deepEqual(Object.keys(result.pages), ['home']);
  assert.equal(result.generated, 1);
});
