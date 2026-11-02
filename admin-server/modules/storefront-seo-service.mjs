/**
 * 新官网 SEO 生成服务。
 *
 * 只负责“根据当前官网内容生成中文 SEO 草稿”，保存、修订号和翻译队列仍由
 * commerce-router 处理；生成结果由管理员在「官网 → SEO 设置」里人工修改后保存。
 */
export const STOREFRONT_SEO_PAGES = [
  { key: 'home', label: '首页', path: '/' },
  { key: 'about', label: '关于我们', path: '/about/' },
  { key: 'solutions', label: '应用方案', path: '/solutions/' },
  { key: 'shop', label: '商品列表', path: '/shop/' },
  { key: 'product', label: '商品详情（模板）', path: '/shop/product/' },
  { key: 'contact', label: '联系我们', path: '/contact/' },
  { key: 'news', label: '新闻动态', path: '/news/' },
  { key: 'shipping', label: '配送政策', path: '/shipping/' },
  { key: 'returns', label: '退货与退款', path: '/returns/' },
  { key: 'privacy', label: '隐私政策', path: '/privacy/' },
  { key: 'terms', label: '销售条款', path: '/terms/' },
  { key: 'cookies', label: 'Cookie 政策', path: '/cookies/' },
  { key: 'cart', label: '购物车与结账', path: '/cart/' },
  { key: 'not-found', label: '404 页面', path: '/404/' }
];

const SKIP_KEYS = /^(seo|id|slug|href|url|src|path|phone|email|icon|logoUrl|image|images|video|videos|media|cover|poster|thumbnail|background|download|endpoint|key)$/i;

function flattenText(value, key = '', out = []) {
  if (out.length >= 40) return out;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text && !SKIP_KEYS.test(key) && !/^https?:\/\//i.test(text) && !text.startsWith('/')) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenText(item, key, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      if (SKIP_KEYS.test(childKey)) continue;
      flattenText(child, childKey, out);
      if (out.length >= 40) break;
    }
  }
  return out;
}

function pageMaterial(content, key, policies = {}) {
  const direct = {
    home: [content.brand, content.home, content.announcement],
    about: [content.brand, content.about],
    solutions: [content.brand, content.solutions],
    shop: [content.brand, content.shop],
    product: [content.brand, content.shop],
    contact: [content.brand, content.contact],
    news: [content.brand, content.news],
    cart: [content.brand, content.cart],
    shipping: [{ text: policies.shipping_policy }],
    returns: [{ text: policies.returns_policy }],
    privacy: [{ text: policies.privacy_policy }],
    terms: [{ text: policies.terms_policy }],
    cookies: [{ text: policies.cookie_policy }],
    'not-found': [{ text: '页面不存在或已移动' }]
  }[key] || [];
  return [...new Set(flattenText(direct).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean))].join('\n').slice(0, 3500);
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizePage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = cleanText(value.title, 70);
  const description = cleanText(value.description, 180);
  const keywords = cleanText(value.keywords, 300);
  if (!title && !description && !keywords) return null;
  return { title, description, keywords };
}

export function createStorefrontSeoService({ aiService }) {
  if (!aiService?.generateJson) throw new Error('SEO 服务缺少文本 AI 生成器。');

  async function generate({ content = {}, products = [], policies = {} } = {}) {
    const pageBlocks = STOREFRONT_SEO_PAGES.map((page) => {
      const material = pageMaterial(content, page.key, policies);
      const productNames = page.key === 'shop' || page.key === 'product'
        ? products.slice(0, 12).map((item) => [item.name, item.category].filter(Boolean).join(' / ')).join('；')
        : '';
      return `页面 ${page.key}（${page.label}，${page.path}）：\n${material || '（暂无正文，按品牌与商品资料生成）'}${productNames ? `\n商品：${productNames}` : ''}`;
    }).join('\n\n');

    const prompt = [
      '你是宏盟机械（Hongmeng Machinery）的英文/中文 SEO 编辑，为工程机械属具与配件官网撰写中文 SEO 草稿。',
      '只返回 JSON 对象，结构必须是：{"pages":{"home":{"title":"","description":"","keywords":""}, ...}}。',
      '必须覆盖这些页面：' + STOREFRONT_SEO_PAGES.map((page) => page.key).join('、') + '。',
      '标题 30–60 个中文字符，不要包含“宏盟机械”或“Hongmeng Machinery”（前台会自动追加品牌）；描述 70–160 个中文字符；关键词 4–8 个，用英文逗号分隔。',
      '不要编造不存在的认证、参数、客户、价格或承诺；语言自然、专业、适合国际 B2B 采购。',
      '商品详情模板页可以用 {name}、{category}、{sku} 占位符；其他页面不要使用占位符。',
      '页面资料：',
      pageBlocks
    ].join('\n\n');

    const result = await aiService.generateJson(prompt, {
      type: 'object',
      capability: 'seo',
      system: '你是严格的 B2B 工业品牌 SEO 编辑，只返回合法 JSON，不解释。',
      temperature: 0.3,
      maxTokens: 8000
    });
    const rawPages = result?.pages && typeof result.pages === 'object' ? result.pages : result;
    const pages = {};
    let generated = 0;
    for (const page of STOREFRONT_SEO_PAGES) {
      const normalized = normalizePage(rawPages?.[page.key]);
      if (normalized) {
        pages[page.key] = normalized;
        generated += 1;
      }
    }
    if (!generated) throw new Error('SEO 模型没有返回可用的页面标题与描述，请重试。');
    return { pages, generated };
  }

  return { generate, pages: STOREFRONT_SEO_PAGES };
}
