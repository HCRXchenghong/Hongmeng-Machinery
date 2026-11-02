import crypto from 'node:crypto';
import { CONSENT_MAX_AGE_MS, readConsentCookie } from './consent-cookie.mjs';

const STATUSES = new Set(['pending', 'confirmed', 'paid', 'fulfilling', 'shipped', 'completed', 'cancelled']);
const PAYMENT_PROVIDERS = new Set(['manual', 'stripe', 'paypal']);
const NEXT_STATUS = {
  pending: new Set(['confirmed', 'paid', 'cancelled']),
  confirmed: new Set(['paid', 'cancelled']),
  paid: new Set(['fulfilling']),
  fulfilling: new Set(['shipped']),
  shipped: new Set(['completed']),
  completed: new Set(),
  cancelled: new Set()
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function failure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clean(value, limit = 255) {
  return String(value ?? '').trim().slice(0, limit);
}

// 商品级运费规则在模块级校验，供 productInput 与路由共用。
const PRODUCT_COUNTRY_ALIASES = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', america: 'US',
  canada: 'CA', 'united kingdom': 'GB', uk: 'GB', australia: 'AU', 'new zealand': 'NZ',
  'united arab emirates': 'AE', uae: 'AE', 'saudi arabia': 'SA', qatar: 'QA', kuwait: 'KW',
  oman: 'OM', bahrain: 'BH', germany: 'DE', france: 'FR', italy: 'IT', spain: 'ES',
  netherlands: 'NL', poland: 'PL', sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI',
  ireland: 'IE', belgium: 'BE', austria: 'AT', switzerland: 'CH', mexico: 'MX', brazil: 'BR',
  argentina: 'AR', chile: 'CL', 'south africa': 'ZA', india: 'IN', japan: 'JP', 'south korea': 'KR',
  singapore: 'SG', malaysia: 'MY', indonesia: 'ID', philippines: 'PH', thailand: 'TH', vietnam: 'VN'
};
function productCountryCode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (/^[a-z]{2}$/i.test(text)) return text.toUpperCase();
  return PRODUCT_COUNTRY_ALIASES[text] || '';
}
function normalizeProductShippingRules(input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const mode = ['inherit', 'collect', 'manual'].includes(value.mode) ? value.mode : 'inherit';
  const zones = (Array.isArray(value.zones) ? value.zones : []).slice(0, 30).map((zone, index) => {
    const countries = [...new Set((Array.isArray(zone?.countries) ? zone.countries : []).map(productCountryCode).filter(Boolean))];
    const zoneMode = ['flat', 'free', 'collect', 'manual'].includes(zone?.mode) ? zone.mode : 'flat';
    const amount = Math.round(Number(zone?.amount_cents ?? 0));
    if (!countries.length) throw failure(`第 ${index + 1} 个商品运费地区至少需要一个国家代码。`);
    if (!Number.isSafeInteger(amount) || amount < 0) throw failure(`第 ${index + 1} 个商品运费地区金额无效。`);
    return {
      id: clean(zone?.id, 80) || `product_zone_${index + 1}`,
      name: clean(zone?.name, 80) || `地区 ${index + 1}`,
      countries,
      mode: zoneMode,
      amount_cents: zoneMode === 'flat' ? amount : 0,
      active: zone?.active !== false
    };
  });
  return { mode, zones };
}

function productInput(body) {
  if (!body || typeof body !== 'object') throw failure('商品数据无效。');
  const item = {
    id: clean(body.id, 80) || crypto.randomUUID(),
    sku: clean(body.sku, 80),
    slug: clean(body.slug, 120),
    category: clean(body.category || '设备附件', 80),
    name: clean(body.name, 180),
    summary: clean(body.summary, 600),
    description: clean(body.description, 12000),
    image_url: clean(body.image_url, 2000),
    gallery: Array.isArray(body.gallery) ? body.gallery.map((value) => clean(value, 2000)).filter(Boolean).slice(0, 12) : [],
    highlights: Array.isArray(body.highlights) ? body.highlights.map((value) => clean(value, 500)).filter(Boolean).slice(0, 20) : [],
    specifications: Array.isArray(body.specifications) ? body.specifications.slice(0, 40).map((entry) => ({ label: clean(entry?.label, 100), value: clean(entry?.value, 500) })).filter((entry) => entry.label && entry.value) : [],
    faqs: Array.isArray(body.faqs) ? body.faqs.slice(0, 20).map((entry) => ({ question: clean(entry?.question, 500), answer: clean(entry?.answer, 3000) })).filter((entry) => entry.question && entry.answer) : [],
    videos: Array.isArray(body.videos) ? body.videos.map((value) => {
      if (typeof value === 'string') return clean(value, 2000);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
      const url = clean(value.url || value.src, 2000);
      return url ? { url, type: 'video', autoplay: value.autoplay === true, muted: value.muted !== false, youtubeLink: clean(value.youtubeLink, 2000) } : '';
    }).filter(Boolean).slice(0, 8) : [],
    price_cents: Number(body.price_cents),
    currency: ['USD', 'CNY'].includes(body.currency) ? body.currency : 'USD',
    stock: Number(body.stock),
    allow_backorder: body.allow_backorder === true,
    active: body.active === true,
    featured: body.featured === true,
    sort_order: Number(body.sort_order || 0),
    shipping_rules: normalizeProductShippingRules(body.shipping_rules)
  };
  if (!item.sku || !item.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw failure('SKU、商品名称和小写英文短横线 slug 必填。');
  if (!Number.isSafeInteger(item.price_cents) || item.price_cents < 0 || item.price_cents > 2_147_483_647) throw failure('价格必须为数据库允许的非负整数分。');
  if (item.active && item.price_cents <= 0) throw failure('上架销售的商品必须设置大于零的价格。');
  if (!Number.isSafeInteger(item.stock) || item.stock < 0 || item.stock > 2_147_483_647) throw failure('库存必须为数据库允许的非负整数。');
  if (!Number.isSafeInteger(item.sort_order) || item.sort_order < -2_147_483_648 || item.sort_order > 2_147_483_647) throw failure('排序值无效。');
  if (item.image_url && !validImageUrl(item.image_url)) throw failure('图片地址必须是 HTTPS 或站内路径。');
  if (item.gallery.some((url) => !validImageUrl(url))) throw failure('图库地址必须是 HTTPS 或站内路径。');
  if (item.videos.some((entry) => !validImageUrl(typeof entry === 'string' ? entry : entry.url) || (typeof entry !== 'string' && entry.youtubeLink && !validImageUrl(entry.youtubeLink)))) throw failure('视频地址必须是 HTTPS 或站内路径。');
  return item;
}

function validImageUrl(value) {
  return value.startsWith('/') && !value.startsWith('//') || /^https:\/\//i.test(value);
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '\"': '&quot;' })[character]);
}

function orderInput(body) {
  if (!body || typeof body !== 'object') throw failure('订单数据无效。');
  const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const address = body.shipping_address && typeof body.shipping_address === 'object' ? body.shipping_address : {};
  const items = Array.isArray(body.items) ? body.items : [];
  const requestedProvider = clean(body.payment_provider, 20);
  if (requestedProvider && !PAYMENT_PROVIDERS.has(requestedProvider)) throw failure('不支持的支付方式。');
  if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw failure('购物车商品数据无效。');
  const payload = {
    customer_name: clean(customer.name, 120),
    legal_name: clean(customer.legal_name, 120),
    email: clean(customer.email, 180).toLowerCase(),
    phone: clean(customer.phone, 60),
    shipping_address: {
      country: clean(address.country || 'United States', 80),
      province: clean(address.province, 100),
      city: clean(address.city, 100),
      line1: clean(address.line1, 300),
      line2: clean(address.line2, 300),
      postal_code: clean(address.postal_code, 30)
    },
    note: clean(body.note, 1000),
    items: items.map((item) => ({ id: clean(item.id, 80), quantity: Number(item.quantity) })),
    idempotency_key: clean(body.idempotency_key, 100),
    payment_provider: requestedProvider,
    expected_total_cents: Number(body.expected_total_cents),
    cart_nonce: clean(body.cart_nonce, 64).replace(/[^A-Za-z0-9-]/g, ''),
    // 客户端在允许可选存储的那一刻打的时间戳；只作同意凭据，格式不对就当没传。
    consent_analytics_at: Number.isFinite(Date.parse(String(body.consent_analytics_at || ''))) ? String(body.consent_analytics_at) : ''
  };
  if (!payload.customer_name || !EMAIL.test(payload.email) || !payload.phone) throw failure('请填写姓名、有效邮箱和联系电话。');
  if (!payload.shipping_address.city || !payload.shipping_address.line1) throw failure('请填写城市和详细收货地址。');
  if (payload.items.length < 1 || payload.items.length > 20 || payload.items.some((item) => !item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) throw failure('购物车商品数量无效。');
  if (new Set(payload.items.map((item) => item.id)).size !== payload.items.length) throw failure('购物车有重复商品。');
  if (!payload.idempotency_key) throw failure('缺少幂等请求标识。');
  if (typeof body.expected_total_cents !== 'number' || !Number.isSafeInteger(payload.expected_total_cents) || payload.expected_total_cents < 0 || payload.expected_total_cents > 2_147_483_647) throw failure('缺少有效的订单确认金额。');
  return payload;
}

function publicProduct(row) {
  return {
    id: row.id, sku: row.sku, slug: row.slug, category: row.category, name: row.name,
    summary: row.summary, description: row.description, image_url: row.image_url,
    gallery: row.gallery, highlights: row.highlights || [], specifications: row.specifications || [], faqs: row.faqs || [], videos: row.videos || [], price_cents: row.price_cents, currency: row.currency,
    stock: row.stock, allow_backorder: row.allow_backorder === true, available: row.stock > 0 || row.allow_backorder === true, featured: row.featured
  };
}

/**
 * 同意凭据：优先用埋点签发的 HttpOnly Cookie（XSS 读不到也改不了），
 * 拿不到时才退回到前端带的时间戳（只在 12 小时内、且不晚于 5 分钟后才认）。
 */
function consentProof(req, fallbackTimestamp) {
  if (readConsentCookie(req)) return { ok: true, source: 'cookie' };
  const stamp = Date.parse(String(fallbackTimestamp || ''));
  if (Number.isFinite(stamp) && Date.now() - stamp < CONSENT_MAX_AGE_MS && stamp - Date.now() < 5 * 60_000) {
    return { ok: true, source: 'timestamp' };
  }
  return { ok: false, message: '请先允许 Cookie 再提交订单：页面右下角的 Cookie 弹窗里点「允许」即可。' };
}

/** 同邮箱 + 同清单 + 同金额 + 15 分钟内视为同一单（幂等键在浏览器里，清存储/双击都会变）。 */
function canonicalItems(items) {
  return JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, item.quantity]));
}

async function findRecentDuplicate(query, input) {
  // 有批次标识时只认同一批：双击/断网重试会被合并，而「再买一次同样的东西」会拿到新批次号，不会被吞。
  const rows = await query(
    "SELECT * FROM shop_orders WHERE status='pending' AND lower(email)=$1 AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 10",
    [String(input.email).toLowerCase()]
  );
  return rows.rows.find((row) => {
    if (canonicalItems(row.items) !== canonicalItems(input.items)) return false;
    if (Number(row.total_cents) !== input.expected_total_cents) return false;
    if (input.cart_nonce) return String(row.cart_nonce || '') === input.cart_nonce;
    return true;
  }) || null;
}

export function createCommerceRouter({ store, bodyJson, json, verifySession, verifyAdminPassword = null, applyPublicCors = () => true, requestIp = null, auditEvent = async () => {}, storefrontTranslationService = null, storefrontSeoService = null, siteOrigin = process.env.PUBLIC_SITE_URL || 'http://127.0.0.1:4331' }) {
  const checkoutAttempts = new Map();

  // 按国家/地区配置运费。国家列存 ISO alpha-2；也兼容常见英文全称。
  const COUNTRY_ALIASES = {
    'united states': 'US', 'united states of america': 'US', usa: 'US', america: 'US',
    canada: 'CA', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB',
    australia: 'AU', 'new zealand': 'NZ', 'united arab emirates': 'AE', uae: 'AE',
    'saudi arabia': 'SA', qatar: 'QA', kuwait: 'KW', oman: 'OM', bahrain: 'BH',
    germany: 'DE', france: 'FR', italy: 'IT', spain: 'ES', netherlands: 'NL',
    poland: 'PL', sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI',
    ireland: 'IE', belgium: 'BE', austria: 'AT', switzerland: 'CH',
    mexico: 'MX', brazil: 'BR', argentina: 'AR', chile: 'CL', southafrica: 'ZA',
    'south africa': 'ZA', india: 'IN', japan: 'JP', 'south korea': 'KR', singapore: 'SG',
    malaysia: 'MY', indonesia: 'ID', philippines: 'PH', thailand: 'TH', vietnam: 'VN'
  };
  function countryCode(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (/^[a-z]{2}$/i.test(text)) return text.toUpperCase();
    return COUNTRY_ALIASES[text] || '';
  }
  function normalizeShippingZones(input) {
    const list = Array.isArray(input) ? input : [];
    return list.slice(0, 30).map((zone, index) => {
      const countries = [...new Set((Array.isArray(zone?.countries) ? zone.countries : []).map(countryCode).filter(Boolean))];
      const mode = zone?.mode === 'quote' ? 'quote' : 'flat';
      const amount = Math.round(Number(zone?.amount_cents ?? 0));
      if (!countries.length) throw failure(`第 ${index + 1} 个运费地区的国家列表不能为空。`);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) throw failure(`第 ${index + 1} 个运费地区的金额无效。`);
      return {
        id: clean(zone?.id, 80) || `zone_${index + 1}`,
        name: clean(zone?.name, 80) || `地区 ${index + 1}`,
        countries,
        mode,
        amount_cents: amount,
        active: zone?.active !== false
      };
    });
  }
  function shippingForCountry(settings, country) {
    const code = countryCode(country);
    const zones = normalizeShippingZones(settings.shipping_zones || []);
    const zone = zones.find((item) => item.active && item.countries.includes(code));
    if (zone) return { mode: zone.mode, amount_cents: zone.mode === 'flat' ? zone.amount_cents : 0, zone };
    return {
      mode: settings.shipping_mode === 'flat' ? 'flat' : 'quote',
      amount_cents: settings.shipping_mode === 'flat' ? Number(settings.shipping_cents || 0) : 0,
      zone: null
    };
  }

  const PRODUCT_SHIPPING_MODES = new Set(['inherit', 'collect', 'manual']);
  const PRODUCT_ZONE_MODES = new Set(['flat', 'free', 'collect', 'manual']);
  function normalizeProductShippingRules(input) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const mode = PRODUCT_SHIPPING_MODES.has(value.mode) ? value.mode : 'inherit';
    const zones = (Array.isArray(value.zones) ? value.zones : []).slice(0, 30).map((zone, index) => {
      const countries = [...new Set((Array.isArray(zone?.countries) ? zone.countries : []).map(countryCode).filter(Boolean))];
      const zoneMode = PRODUCT_ZONE_MODES.has(zone?.mode) ? zone.mode : 'flat';
      const amount = Math.round(Number(zone?.amount_cents ?? 0));
      if (!countries.length) throw failure(`第 ${index + 1} 个商品运费地区至少需要一个国家代码。`);
      if (!Number.isSafeInteger(amount) || amount < 0) throw failure(`第 ${index + 1} 个商品运费地区金额无效。`);
      return {
        id: clean(zone?.id, 80) || `product_zone_${index + 1}`,
        name: clean(zone?.name, 80) || `地区 ${index + 1}`,
        countries,
        mode: zoneMode,
        amount_cents: zoneMode === 'flat' ? amount : 0,
        active: zone?.active !== false
      };
    });
    return { mode, zones };
  }
  function shippingForProductLine(product, country, general) {
    const rules = normalizeProductShippingRules(product.shipping_rules);
    const code = countryCode(country);
    const zone = rules.zones.find((item) => item.active && item.countries.includes(code));
    const mode = zone?.mode || rules.mode;
    if (mode === 'flat') return { mode, amount_cents: Number(zone?.amount_cents || 0), zone };
    if (mode === 'free') return { mode, amount_cents: 0, zone };
    if (mode === 'collect') return { mode, amount_cents: 0, zone };
    if (mode === 'manual') return { mode, amount_cents: 0, zone };
    // inherit：命中通用地区则沿用通用运费；通用报价也视为需要人工报价。
    return { mode: general.mode === 'flat' ? 'inherit' : 'manual', amount_cents: general.mode === 'flat' ? general.amount_cents : 0, zone: null };
  }
  function calculateCartShipping(settings, lines, country) {
    const general = shippingForCountry(settings, country);
    let amount = 0;
    let manual = false;
    let collect = false;
    let inherited = false;
    let inheritedAmount = 0;
    const breakdown = [];
    for (const line of lines) {
      const item = shippingForProductLine(line, country, general);
      let lineAmount = 0;
      if (item.mode === 'flat') lineAmount = item.amount_cents;
      else if (item.mode === 'collect') collect = true;
      else if (item.mode === 'manual') manual = true;
      else {
        if (!inherited) {
          inherited = true;
          inheritedAmount = item.amount_cents;
        }
      }
      breakdown.push({ product_id: line.id, sku: line.sku, mode: item.mode, amount_cents: lineAmount });
    }
    amount += inheritedAmount;
    for (const line of breakdown) amount += line.amount_cents;
    if (manual) return { shipping_status: 'quote_pending', shipping_cents: 0, collect, manual: true, breakdown };
    if (collect) return { shipping_status: 'collect', shipping_cents: amount, collect: true, manual: false, breakdown };
    return { shipping_status: 'included', shipping_cents: amount, collect: false, manual: false, breakdown };
  }

  // 新官网 SEO：存在 storefront_content.seo.pages 下，按页面 key 维护。
  // 手动编辑与 AI 生成写同一份结构，翻译服务会随 storefront_content 一起处理。
  const SEO_PAGE_KEYS = new Set(['home', 'about', 'solutions', 'shop', 'product', 'contact', 'news', 'shipping', 'returns', 'privacy', 'terms', 'cookies', 'cart', 'not-found']);
  function normalizeStorefrontSeo(input) {
    const pages = input && typeof input === 'object' && input.pages && typeof input.pages === 'object' && !Array.isArray(input.pages) ? input.pages : {};
    const normalized = {};
    for (const [key, value] of Object.entries(pages)) {
      if (!SEO_PAGE_KEYS.has(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const title = clean(value.title, 70);
      const description = clean(value.description, 180);
      const keywords = clean(value.keywords, 300);
      const image = clean(value.image, 2048);
      if (image && !(image.startsWith('/') && !image.startsWith('//')) && !/^https:\/\//i.test(image)) {
        throw failure(`${key}.image 仅允许 HTTPS 或站内路径。`);
      }
      if (!title && !description && !keywords && !image) continue;
      normalized[key] = { title, description, keywords, image };
    }
    return { pages: normalized };
  }
  async function readStorefrontContent() {
    const result = await store.query('SELECT storefront_content FROM shop_settings WHERE id=1');
    return result.rows[0]?.storefront_content && typeof result.rows[0].storefront_content === 'object'
      ? result.rows[0].storefront_content
      : {};
  }
  async function saveStorefrontSeo(content, seo) {
    const next = { ...content, seo };
    const serialized = JSON.stringify(next);
    if (serialized.length > 120000) throw failure('网站页面配置最多 120 KB。');
    const saved = await store.query('UPDATE shop_settings SET storefront_content=$1::jsonb,updated_at=now() WHERE id=1 RETURNING storefront_content', [serialized]);
    return saved.rows[0]?.storefront_content || next;
  }
  async function paymentSecrets() {
    const setting = await Promise.resolve(store.readRuntimeSetting ? store.readRuntimeSetting('shop-payments') : null).catch(() => null);
    const secrets = setting?.secrets || {};
    return {
      stripeSecret: process.env.STRIPE_SECRET_KEY || secrets.stripeSecret || '',
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || secrets.stripeWebhookSecret || '',
      paypalClientId: process.env.PAYPAL_CLIENT_ID || secrets.paypalClientId || '',
      paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || secrets.paypalClientSecret || '',
      paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || secrets.paypalWebhookId || '',
      paypalMode: process.env.PAYPAL_MODE || secrets.paypalMode || 'sandbox'
    };
  }
  async function paymentConfigured(provider) {
    if (provider === 'manual' || !provider) return true;
    const secrets = await paymentSecrets();
    if (provider === 'stripe') return Boolean(secrets.stripeSecret && secrets.stripeWebhookSecret);
    if (provider === 'paypal') return Boolean(secrets.paypalClientId && secrets.paypalClientSecret && secrets.paypalWebhookId);
    return false;
  }
  async function rawBody(req, limit = 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw failure('支付回调体积过大。', 413); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function orderByNumber(number) {
    const result = await store.query('SELECT * FROM shop_orders WHERE order_number=$1', [number]);
    return result.rows[0] || null;
  }
  function phoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }
  function phoneMatches(order, phone) {
    const supplied = phoneDigits(phone);
    if (supplied.length < 6) return false;
    const stored = phoneDigits(order.phone);
    if (!stored) return false;
    return stored === supplied || stored.endsWith(supplied.slice(-7)) || supplied.endsWith(stored.slice(-7));
  }

  async function customerForRequest(req) {
    const token = String(req.headers?.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('hongmeng_customer_session='))?.slice('hongmeng_customer_session='.length);
    if (!token) return null;
    let decoded = token; try { decoded = decodeURIComponent(token); } catch {}
    const tokenHash = crypto.createHash('sha256').update(decoded).digest('hex');
    return (await store.query('SELECT c.id,c.email,c.full_name,c.phone,c.legal_name,c.payment_customer_id FROM shop_customer_sessions s JOIN shop_customers c ON c.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at>now()', [tokenHash])).rows[0] || null;
  }
  async function capturePayment(orderId, providerId, action, amounts = {}) {
    const result = await store.withTransaction(async (client) => {
      const current = (await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
      if (!current) return null;
      if (action === 'paid' && current.payment_status !== 'paid') {
        if (current.shipping_status === 'quote_pending' || (current.shipping_status === 'quoted' && !current.shipping_accepted_at)) throw failure('客户尚未接受最终运费报价，不能登记收款。', 409);
        const taxCents = Number.isSafeInteger(amounts.taxCents) ? amounts.taxCents : Number(current.tax_cents || 0);
        const totalCents = Number.isSafeInteger(amounts.totalCents) ? amounts.totalCents : Number(current.total_cents || 0);
        await client.query("UPDATE shop_orders SET payment_status='paid',tax_cents=$2,total_cents=$3,status=CASE WHEN status IN ('pending','confirmed') THEN 'paid' ELSE status END,updated_at=now() WHERE id=$1", [orderId, taxCents, totalCents]);
        await client.query('INSERT INTO shop_order_events (order_id,action,detail,actor) VALUES ($1,$2,$3::jsonb,$4)', [orderId, 'payment.succeeded', JSON.stringify({ provider_payment_id: providerId }), 'payment-provider']);
      } else if (action === 'failed') {
        await client.query("UPDATE shop_orders SET payment_status='failed',updated_at=now() WHERE id=$1 AND payment_status<>'paid'", [orderId]);
      } else if (action === 'refunded') {
        await client.query("UPDATE shop_orders SET payment_status='refunded',updated_at=now() WHERE id=$1", [orderId]);
      }
      return current;
    });
    return result;
  }
  async function applyStripeRefundedAmount(orderId, cumulativeCents) {
    if (!Number.isSafeInteger(cumulativeCents) || cumulativeCents <= 0) return;
    await store.withTransaction(async (client) => {
      const current = (await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
      if (!current) return;
      const nextRefunded = Math.min(Number(current.total_cents || 0), Math.max(Number(current.refunded_cents || 0), cumulativeCents));
      const nextStatus = nextRefunded >= Number(current.total_cents || 0) ? 'refunded' : 'partially_refunded';
      await client.query("UPDATE shop_orders SET payment_status=$2,refunded_cents=$3,refunded_at=now(),updated_at=now() WHERE id=$1", [orderId, nextStatus, nextRefunded]);
      await client.query("UPDATE shop_refund_requests SET status=$2,processed_at=now(),refunded_cents=GREATEST(refunded_cents,$3) WHERE order_id=$1 AND status='pending'", [orderId, nextStatus === 'refunded' ? 'refunded' : 'partial', nextRefunded]).catch(() => {});
    });
  }

  async function failPendingPayment(orderId, providerId) {
    await store.withTransaction(async (client) => {
      const order = (await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
      if (!order || order.payment_status === 'paid' || order.status === 'cancelled' || order.status !== 'pending') return;
      for (const item of order.items || []) {
        const restoreQuantity = Number.isSafeInteger(item.stock_reserved_quantity) ? item.stock_reserved_quantity : item.quantity;
        if (restoreQuantity > 0) await client.query('UPDATE shop_products SET stock=stock+$2,updated_at=now() WHERE id=$1', [item.id, restoreQuantity]);
      }
      await client.query("UPDATE shop_orders SET status='cancelled',payment_status='failed',updated_at=now() WHERE id=$1", [orderId]);
      await client.query('INSERT INTO shop_order_events (order_id,action,detail,actor) VALUES ($1,$2,$3::jsonb,$4)', [orderId, 'payment.failed', JSON.stringify({ provider_payment_id: providerId }), 'payment-provider']);
    });
  }
  async function createPaymentLink(order, provider, secrets) {
    if (order.currency !== 'USD') throw failure('当前在线支付通道仅支持 USD。请先将店铺和商品货币设置为美元，或使用人工确认。', 409);
    if (provider === 'stripe') {
      if (!secrets.stripeSecret) throw failure('尚未配置 Stripe Secret Key。', 503);
      const form = new URLSearchParams();
      form.set('mode', 'payment');
      if (order.payment_customer_id) form.set('customer', order.payment_customer_id);
      else form.set('customer_creation', 'always');
      form.set('customer_email', order.email);
      form.set('success_url', `${siteOrigin.replace(/\/$/, '')}/cart/?payment=success&order=${encodeURIComponent(order.order_number)}&session_id={CHECKOUT_SESSION_ID}`);
      form.set('cancel_url', `${siteOrigin.replace(/\/$/, '')}/cart/?payment=cancelled&order=${encodeURIComponent(order.order_number)}`);
      form.set('metadata[order_id]', order.id);
      form.set('payment_intent_data[metadata][order_id]', order.id);
      // Stripe Tax：金额按未税价提交，结账页按客户地址自动计算税费；
      // 税额最终以 Stripe 返回的 total_details.amount_tax 为准，Webhook 校验后写回订单。
      form.set('automatic_tax[enabled]', 'true');
      form.set('billing_address_collection', 'required');
      form.set('tax_id_collection[enabled]', 'true');
      for (let index = 0; index < order.items.length; index += 1) {
        const line = order.items[index];
        form.set(`line_items[${index}][quantity]`, String(line.quantity));
        form.set(`line_items[${index}][price_data][currency]`, 'usd');
        form.set(`line_items[${index}][price_data][unit_amount]`, String(line.price_cents));
        form.set(`line_items[${index}][price_data][tax_behavior]`, 'exclusive');
        form.set(`line_items[${index}][price_data][product_data][name]`, line.name);
      }
      if (order.shipping_cents > 0) {
        const index = order.items.length;
        form.set(`line_items[${index}][quantity]`, '1'); form.set(`line_items[${index}][price_data][currency]`, 'usd');
        form.set(`line_items[${index}][price_data][unit_amount]`, String(order.shipping_cents));
        form.set(`line_items[${index}][price_data][tax_behavior]`, 'exclusive');
        form.set(`line_items[${index}][price_data][product_data][name]`, 'Shipping');
      }
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${secrets.stripeSecret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': order.id }, body: form });
      const payload = await response.json(); if (!response.ok || !payload.url) throw failure('Stripe 无法创建付款会话，请检查商户配置。', 502);
      return { url: payload.url, id: payload.id };
    }
    if (provider === 'paypal') {
      if (!secrets.paypalClientId || !secrets.paypalClientSecret) throw failure('尚未配置 PayPal Client ID 和 Secret。', 503);
      const base = secrets.paypalMode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const auth = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${secrets.paypalClientId}:${secrets.paypalClientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
      const token = await auth.json(); if (!auth.ok || !token.access_token) throw failure('PayPal 身份验证失败，请检查商户配置。', 502);
      const value = (cents) => (cents / 100).toFixed(2);
      const response = await fetch(`${base}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': order.id }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: order.order_number, custom_id: order.id, amount: { currency_code: 'USD', value: value(order.total_cents), breakdown: { item_total: { currency_code: 'USD', value: value(order.subtotal_cents) }, shipping: { currency_code: 'USD', value: value(order.shipping_cents) } } }, items: order.items.map((line) => ({ name: line.name.slice(0, 127), quantity: String(line.quantity), unit_amount: { currency_code: 'USD', value: value(line.price_cents) } })) }], application_context: { brand_name: 'Hongmeng Machinery', user_action: 'PAY_NOW', return_url: `${siteOrigin.replace(/\/$/, '')}/cart/?payment=success&order=${encodeURIComponent(order.order_number)}`, cancel_url: `${siteOrigin.replace(/\/$/, '')}/cart/?payment=cancelled&order=${encodeURIComponent(order.order_number)}` } }) });
      const payload = await response.json(); if (!response.ok) throw failure('PayPal 无法创建付款订单，请检查商户配置。', 502);
      const approval = payload.links?.find((link) => link.rel === 'approve'); if (!approval?.href) throw failure('PayPal 未返回付款确认链接。', 502);
      return { url: approval.href, id: payload.id };
    }
    throw failure('当前订单设置为人工确认付款。', 409);
  }
  async function publicRequest(req, res) {
    if (!applyPublicCors(req, res)) throw failure('当前来源不允许访问商城。', 403);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }
    return false;
  }
  async function localizedContent(req, res) {
    if (!storefrontTranslationService) return { content: null, locale: 'en', bypass: true };
    const locale = new URL(req.url, 'http://localhost').searchParams.get('locale') || 'en';
    const localized = await storefrontTranslationService.publicContent(locale);
    return { content: localized.content, locale, meta: localized.meta };
  }
  function mergeLocalizedProduct(product, translatedProduct) {
    if (!translatedProduct) return product;
    return {
      ...product,
      category: translatedProduct.category || product.category,
      name: translatedProduct.name || product.name,
      summary: translatedProduct.summary || product.summary,
      description: translatedProduct.description || product.description,
      highlights: translatedProduct.highlights || product.highlights,
      specifications: translatedProduct.specifications || product.specifications,
      faqs: translatedProduct.faqs || product.faqs
    };
  }

  return async function handleCommerce(req, res, pathname) {
    const publicRoute = pathname.startsWith('/site-admin-api/shop/');
    const adminRoute = pathname.startsWith('/site-admin-api/commerce/');
    if (!publicRoute && !adminRoute) return false;
    try {
      if (publicRoute && await publicRequest(req, res)) return true;
      if (adminRoute && !verifySession(req)) throw failure('请先登录。', 401);

      if (pathname === '/site-admin-api/shop/translated-content' && req.method === 'GET') {
        const locale = new URL(req.url, 'http://localhost').searchParams.get('locale') || 'en';
        const result = storefrontTranslationService
          ? await storefrontTranslationService.publicContent(locale)
          : { content: null, meta: { locale, status: 'unavailable' } };
        json(res, result.content ? 200 : 202, { data: result.content, meta: result.meta });
        return true;
      }
      if (pathname === '/site-admin-api/shop/sitemap-products.xml' && req.method === 'GET') {
        const site = siteOrigin.replace(/\/$/, '');
        const rows = await store.query('SELECT slug,updated_at,image_url,gallery FROM shop_products WHERE active=true ORDER BY sort_order,created_at DESC');
        const languages = [
          { code: 'en-US', prefix: '' },
          { code: 'zh-CN', prefix: '/zh' },
          { code: 'ar', prefix: '/ar' }
        ];
        const urls = rows.rows.map((product) => {
          const path = `/shop/product/${encodeURIComponent(product.slug)}/`;
          const lastmod = product.updated_at ? new Date(product.updated_at).toISOString() : '';
          const alternates = [...languages, { code: 'x-default', prefix: '' }].map(({ code, prefix }) => `<xhtml:link rel="alternate" hreflang="${code}" href="${xmlEscape(`${site}${prefix}${path}`)}"/>`).join('');
          const imageUrls = [product.image_url, ...(Array.isArray(product.gallery) ? product.gallery : [])]
            .filter((url) => typeof url === 'string' && url.trim())
            .map((url) => `<image:image><image:loc>${xmlEscape(new URL(url, `${site}/`).href)}</image:loc></image:image>`).join('');
          return languages.map(({ prefix }) => `<url><loc>${xmlEscape(`${site}${prefix}${path}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alternates}${imageUrls}</url>`).join('');
        }).join('');
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}</urlset>`);
        return true;
      }
      if (pathname === '/site-admin-api/commerce/translations' && req.method === 'GET') {
        json(res, 200, { data: storefrontTranslationService ? await storefrontTranslationService.statusAll() : { en: { status: 'unavailable', stale: true }, 'zh-CN': { status: 'unavailable', stale: true }, ar: { status: 'unavailable', stale: true } } });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/translations/retranslate' && req.method === 'POST') {
        const body = await bodyJson(req, 8192);
        const locale = clean(body.locale || 'en', 10);
        if (!['en', 'zh-CN', 'ar'].includes(locale)) throw failure('商城仅支持英语、简体中文和阿拉伯语翻译。');
        const result = storefrontTranslationService ? await storefrontTranslationService.retranslate(locale) : null;
        await auditEvent(req, 'commerce.translation.requested', 'storefront-translation', locale, {});
        json(res, 202, { data: { accepted: true, locale, status: result?.status || 'pending' } });
        return true;
      }
      const scheduleStorefrontTranslation = () => {
        if (storefrontTranslationService) void storefrontTranslationService.scheduleIfStale().catch((error) => console.warn(`[商城翻译] 更新任务提交失败：${error?.message || error}`));
      };

      if (pathname === '/site-admin-api/shop/webhooks/stripe' && req.method === 'POST') {
        const secrets = await paymentSecrets(); if (!secrets.stripeWebhookSecret) throw failure('Stripe webhook secret 未配置。', 503);
        const raw = await rawBody(req); const signatureHeader = String(req.headers['stripe-signature'] || '');
        const parts = Object.fromEntries(signatureHeader.split(',').map((part) => part.split('=', 2)));
        const timestamp = Number(parts.t); const signature = parts.v1;
        if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !signature) throw failure('Stripe webhook 签名无效。', 400);
        const digest = crypto.createHmac('sha256', secrets.stripeWebhookSecret).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex');
        const a = Buffer.from(digest); const b = Buffer.from(signature);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw failure('Stripe webhook 签名无效。', 400);
        const event = JSON.parse(raw.toString('utf8')); const object = event.data?.object || {};
        if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && object.payment_status === 'paid') {
          const orderId = object.metadata?.order_id;
          if (orderId) {
            await store.withTransaction(async (client) => {
              const order = (await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
              if (!order || order.payment_provider !== 'stripe' || order.shipping_status === 'quote_pending' || (order.shipping_status === 'quoted' && !order.shipping_accepted_at) || order.currency.toLowerCase() !== object.currency) return;
              const preTax = Number(order.subtotal_cents) + Number(order.shipping_cents || 0);
              const taxCents = Number(object.total_details?.amount_tax || 0);
              const amountSubtotal = Number(object.amount_subtotal ?? (Number(object.amount_total) - taxCents));
              const amountTotal = Number(object.amount_total);
              if (!Number.isSafeInteger(amountSubtotal) || amountSubtotal !== preTax || !Number.isSafeInteger(amountTotal) || amountTotal !== preTax + taxCents) return;
              await client.query("UPDATE shop_orders SET payment_status='paid',tax_cents=$3,total_cents=$4,status=CASE WHEN status IN ('pending','confirmed') THEN 'paid' ELSE status END,provider_payment_id=$2,updated_at=now() WHERE id=$1", [orderId, object.payment_intent || object.id, taxCents, amountTotal]);
              if (order.customer_id && object.customer) await client.query('UPDATE shop_customers SET payment_customer_id=$2 WHERE id=$1', [order.customer_id, object.customer]);
              await client.query('INSERT INTO shop_order_events (order_id,action,detail,actor) VALUES ($1,$2,$3::jsonb,$4)', [orderId, 'payment.succeeded', JSON.stringify({ provider_payment_id: object.id }), 'stripe']);
            });
          }
        } else if (['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
          const orderId = object.metadata?.order_id;
          if (orderId) await failPendingPayment(orderId, object.id);
        } else if (event.type === 'payment_intent.payment_failed') {
          // Stripe Checkout can retry a failed payment intent while its session remains open.
          // The session's terminal async failure or expiration event releases reserved stock.
        } else if (event.type === 'charge.refunded') {
          const orderId = object.metadata?.order_id || (await store.query("SELECT id FROM shop_orders WHERE payment_provider='stripe' AND provider_payment_id=$1", [object.payment_intent || ''])).rows[0]?.id;
          if (orderId) await applyStripeRefundedAmount(orderId, Number(object.amount_refunded || 0));
        }
        json(res, 200, { received: true }); return true;
      }
      if (pathname === '/site-admin-api/shop/webhooks/paypal' && req.method === 'POST') {
        const secrets = await paymentSecrets();
        if (!secrets.paypalWebhookId || !secrets.paypalClientId || !secrets.paypalClientSecret) throw failure('PayPal Webhook 或商户凭据未配置。', 503);
        const raw = await rawBody(req);
        let event;
        try { event = JSON.parse(raw.toString('utf8')); } catch { throw failure('PayPal Webhook JSON 无效。', 400); }
        const headers = req.headers || {};
        const transmissionId = String(headers['paypal-transmission-id'] || '');
        const transmissionTime = String(headers['paypal-transmission-time'] || '');
        const transmissionSig = String(headers['paypal-transmission-sig'] || '');
        const certUrl = String(headers['paypal-cert-url'] || '');
        const authAlgo = String(headers['paypal-auth-algo'] || '');
        if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) throw failure('PayPal Webhook 签名头不完整。', 400);
        const base = secrets.paypalMode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
        const auth = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${secrets.paypalClientId}:${secrets.paypalClientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
        const token = await auth.json();
        if (!auth.ok || !token.access_token) throw failure('PayPal Webhook 校验服务身份验证失败。', 502);
        const verification = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
          method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId, transmission_sig: transmissionSig, transmission_time: transmissionTime, webhook_id: secrets.paypalWebhookId, webhook_event: event })
        });
        const verificationResult = await verification.json();
        if (!verification.ok || verificationResult.verification_status !== 'SUCCESS') throw failure('PayPal Webhook 签名校验失败。', 400);
        const resource = event.resource || {};
        const paypalOrderId = clean(resource.supplementary_data?.related_ids?.order_id || resource.id, 120);
        const orderResult = paypalOrderId ? await store.query("SELECT * FROM shop_orders WHERE payment_provider='paypal' AND provider_payment_id=$1", [paypalOrderId]) : { rows: [] };
        const order = orderResult.rows[0];
        if (order && event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
          const amount = resource.amount || {};
          if (amount.currency_code === order.currency && Math.round(Number(amount.value) * 100) === order.total_cents) await capturePayment(order.id, resource.id, 'paid');
        } else if (order && event.event_type === 'PAYMENT.CAPTURE.DENIED') {
          await failPendingPayment(order.id, resource.id);
        } else if (order && event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
          const amount = resource.amount || {};
          if (amount.currency_code === order.currency && Math.round(Number(amount.value) * 100) >= order.total_cents) await capturePayment(order.id, resource.id, 'refunded');
        }
        json(res, 200, { received: true }); return true;
      }
      if (pathname === '/site-admin-api/shop/payments/paypal/capture' && req.method === 'POST') {
        const body = await bodyJson(req, 8192); const order = await orderByNumber(clean(body.order_number, 80));
        if (!order || order.payment_provider !== 'paypal' || !order.provider_payment_id || order.provider_payment_id !== clean(body.paypal_order_id, 100)) throw failure('找不到对应的 PayPal 待付款订单。', 404);
        if (order.payment_status === 'paid') { json(res, 200, { data: order }); return true; }
        const secrets = await paymentSecrets(); const base = secrets.paypalMode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
        const auth = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${secrets.paypalClientId}:${secrets.paypalClientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
        const token = await auth.json(); if (!auth.ok || !token.access_token) throw failure('PayPal 身份验证失败。', 502);
        const response = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(order.provider_payment_id)}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' } });
        const captured = await response.json(); const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
        if (!response.ok || captured.status !== 'COMPLETED' || capture?.amount?.currency_code !== order.currency || Math.round(Number(capture?.amount?.value) * 100) !== order.total_cents) throw failure('PayPal 付款未能通过金额核验。', 409);
        await capturePayment(order.id, capture.id, 'paid');
        const saved = (await store.query('SELECT order_number,subtotal_cents,shipping_cents,tax_cents,total_cents,currency,status,payment_status FROM shop_orders WHERE id=$1', [order.id])).rows[0];
        json(res, 200, { data: saved }); return true;
      }
      if (pathname === '/site-admin-api/shop/payments/return' && req.method === 'POST') {
        const body = await bodyJson(req, 8192); const order = await orderByNumber(clean(body.order_number, 80));
        const sessionId = clean(body.session_id, 160);
        if (!order || order.payment_provider !== 'stripe' || !sessionId) throw failure('找不到对应的 Stripe 付款记录。', 404);
        const secrets = await paymentSecrets(); if (!secrets.stripeSecret) throw failure('Stripe 未配置。', 503);
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${secrets.stripeSecret}` } });
        const session = await response.json();
        const taxCents = Number(session.total_details?.amount_tax || 0);
        const preTax = Number(order.subtotal_cents) + Number(order.shipping_cents || 0);
        const amountSubtotal = Number(session.amount_subtotal ?? (Number(session.amount_total) - taxCents));
        const amountTotal = Number(session.amount_total);
        if (!response.ok || session.metadata?.order_id !== order.id || amountSubtotal !== preTax || amountTotal !== preTax + taxCents || session.currency !== order.currency.toLowerCase()) throw failure('Stripe 付款信息和当前订单不匹配。', 409);
        if (session.payment_status === 'paid') await capturePayment(order.id, session.payment_intent || session.id, 'paid', { taxCents, totalCents: amountTotal });
        else if (session.status === 'expired') await capturePayment(order.id, session.id, 'failed');
        const saved = (await store.query('SELECT order_number,subtotal_cents,shipping_cents,tax_cents,total_cents,currency,status,payment_status FROM shop_orders WHERE id=$1', [order.id])).rows[0];
        json(res, 200, { data: saved }); return true;
      }

      if (pathname === '/site-admin-api/shop/products' && req.method === 'GET') {
        const rows = await store.query('SELECT * FROM shop_products WHERE active = true ORDER BY sort_order, created_at DESC');
        const localized = await localizedContent(req, res);
        const translated = new Map((localized.content?.products || []).map((product) => [product.id, product]));
        json(res, 200, { data: rows.rows.map((row) => mergeLocalizedProduct(publicProduct(row), translated.get(row.id))) });
        return true;
      }
      const publicProductMatch = pathname.match(/^\/site-admin-api\/shop\/products\/([a-z0-9-]+)$/);
      if (publicProductMatch && req.method === 'GET') {
        const rows = await store.query('SELECT * FROM shop_products WHERE slug = $1 AND active = true', [publicProductMatch[1]]);
        if (!rows.rows[0]) throw failure('商品不存在。', 404);
        const localized = await localizedContent(req, res);
        const translated = (localized.content?.products || []).find((product) => product.id === rows.rows[0].id);
        json(res, 200, { data: mergeLocalizedProduct(publicProduct(rows.rows[0]), translated) });
        return true;
      }
      if (pathname === '/site-admin-api/shop/settings' && req.method === 'GET') {
        const rows = await store.query('SELECT shipping_mode,shipping_cents,shipping_zones, checkout_enabled, support_email, currency, payment_provider FROM shop_settings WHERE id = 1');
        const settings = rows.rows[0] || {};
        const provider = settings.payment_provider || 'manual';
        const currency = settings.currency || 'USD';
        const shippingMode = settings.shipping_mode || 'quote';
        const onlineMethods = currency === 'USD' && settings.checkout_enabled !== false
          ? (await Promise.all(['stripe', 'paypal'].map(async (candidate) => ({ provider: candidate, configured: await paymentConfigured(candidate) }))))
            .filter((method) => method.configured)
            .map((method) => method.provider)
          : [];
        const configuredMethods = shippingMode === 'flat' ? [...onlineMethods] : [];
        if (provider === 'manual' || !configuredMethods.length) configuredMethods.push('manual');
        configuredMethods.sort((left, right) => left === provider ? -1 : right === provider ? 1 : left.localeCompare(right));
        json(res, 200, { data: { ...settings, shipping_mode: shippingMode, shipping_zones: normalizeShippingZones(settings.shipping_zones || []), currency, payment_provider: provider, payment_configured: await paymentConfigured(provider), payment_methods: configuredMethods, quote_payment_methods: onlineMethods } });
        return true;
      }
      if (pathname === '/site-admin-api/shop/policies' && req.method === 'GET') {
        const result = await store.query('SELECT privacy_policy,cookie_policy,terms_policy,shipping_policy,returns_policy FROM shop_settings WHERE id=1');
        const localized = await localizedContent(req, res);
        const translated = localized.content?.policies;
        const hasTranslatedPolicy = translated && Object.values(translated).some((text) => typeof text === 'string' && text.trim());
        json(res, 200, { data: hasTranslatedPolicy ? translated : (result.rows[0] || { privacy_policy: '', cookie_policy: '', terms_policy: '', shipping_policy: '', returns_policy: '' }), meta: localized.meta || { locale: localized.locale, status: 'source' } }); return true;
      }
      if (pathname === '/site-admin-api/shop/storefront' && req.method === 'GET') {
        const result = await store.query('SELECT storefront_content FROM shop_settings WHERE id=1');
        const localized = await localizedContent(req, res);
        const translated = localized.content?.storefront;
        const hasTranslatedStorefront = translated && Object.values(translated).some((value) => value !== '' && value !== null && value !== undefined);
        json(res, 200, { data: hasTranslatedStorefront ? translated : (result.rows[0]?.storefront_content || {}), meta: localized.meta || { locale: localized.locale, status: 'source' } }); return true;
      }
      const quoteAcceptance = pathname.match(/^\/site-admin-api\/shop\/orders\/([^/]+)\/accept-shipping$/);
      if (quoteAcceptance && req.method === 'POST') {
        const customer = await customerForRequest(req);
        if (!customer) throw failure('请先登录客户账户后确认运费报价。', 401);
        const body = await bodyJson(req, 8192);
        const provider = clean(body.payment_provider || 'manual', 20);
        if (!PAYMENT_PROVIDERS.has(provider)) throw failure('不支持的支付方式。');
        const order = await store.withTransaction(async (client) => {
          const current = (await client.query('SELECT o.*,c.payment_customer_id FROM shop_orders o LEFT JOIN shop_customers c ON c.id=o.customer_id WHERE o.id=$1 AND o.customer_id=$2 FOR UPDATE OF o', [quoteAcceptance[1], customer.id])).rows[0];
          if (!current) throw failure('订单不存在。', 404);
          if (current.shipping_status === 'quote_pending') throw failure('运费报价尚未提交。', 409);
          if (current.status === 'cancelled' || current.payment_status === 'paid') throw failure('当前订单不能再确认运费。', 409);
          const total = Number(current.subtotal_cents) + Number(current.shipping_cents || 0);
          if (!Number.isSafeInteger(total) || total !== Number(current.total_cents)) throw failure('订单金额校验失败，请联系客服。', 409);
          if (current.checkout_url === 'creating') throw failure('付款链接正在生成，请稍后再试。', 409);
          if ((current.checkout_url || current.provider_payment_id) && current.payment_provider !== provider) throw failure('该订单已创建另一支付通道的付款链接，请联系客服。', 409);
          if (provider !== 'manual') {
            if (current.currency !== 'USD') throw failure('Stripe 和 PayPal 当前只支持 USD 结算。', 409);
            if (!await paymentConfigured(provider)) throw failure('所选支付通道尚未完成商户凭据和 Webhook 配置。', 503);
            if (current.checkout_url) return { ...current, checkout_url: current.checkout_url, should_create_checkout: false };
          }
          const updated = (await client.query("UPDATE shop_orders SET shipping_status=CASE WHEN shipping_status='quoted' THEN 'accepted' ELSE shipping_status END,shipping_accepted_at=CASE WHEN shipping_status='quoted' THEN COALESCE(shipping_accepted_at,now()) ELSE shipping_accepted_at END,payment_provider=$2,payment_status=CASE WHEN $2='manual' THEN 'unpaid' ELSE 'pending' END,checkout_url=CASE WHEN $2='manual' THEN checkout_url ELSE 'creating' END,updated_at=now() WHERE id=$1 RETURNING *", [current.id, provider])).rows[0];
          return { ...updated, payment_customer_id: current.payment_customer_id || '', should_create_checkout: provider !== 'manual' };
        });
        if (order.checkout_url && !order.should_create_checkout) { json(res, 200, { data: { accepted: true, url: order.checkout_url, payment_provider: order.payment_provider } }); return true; }
        if (!order.should_create_checkout) { json(res, 200, { data: { accepted: true, order_number: order.order_number, shipping_status: order.shipping_status, payment_provider: provider, payment_status: order.payment_status } }); return true; }
        try {
          const session = await createPaymentLink(order, provider, await paymentSecrets());
          await store.query("UPDATE shop_orders SET provider_payment_id=$2,checkout_url=$3,payment_status='pending',updated_at=now() WHERE id=$1", [order.id, session.id, session.url]);
          json(res, 200, { data: { accepted: true, url: session.url, payment_provider: provider } }); return true;
        } catch (paymentError) {
          await store.query("UPDATE shop_orders SET checkout_url='',payment_provider='manual',payment_status='unpaid',updated_at=now() WHERE id=$1 AND checkout_url='creating'", [order.id]);
          throw paymentError;
        }
      }
      if (pathname === '/site-admin-api/shop/refund-requests' && req.method === 'POST') {
        const body = await bodyJson(req, 8192);
        const orderNumber = clean(body.order_number, 80).toUpperCase();
        const reason = clean(body.reason, 1200);
        const contactPhone = clean(body.phone, 80);
        if (!orderNumber || !contactPhone || reason.length < 5) throw failure('请填写订单号、联系电话和退款原因。', 400);
        const order = (await store.query('SELECT * FROM shop_orders WHERE order_number=$1', [orderNumber])).rows[0];
        if (!order || !phoneMatches(order, contactPhone)) throw failure('订单号与联系电话不匹配，请核对后重试。', 404);
        if (order.payment_status !== 'paid') throw failure('只有已付款订单可以申请退款。', 409);
        if (order.payment_status === 'refunded') throw failure('该订单已经退款。', 409);
        const existing = (await store.query("SELECT id,status FROM shop_refund_requests WHERE order_id=$1 AND status='pending'", [order.id])).rows[0];
        if (existing) throw failure('该订单已有待处理的退款申请，请耐心等待。', 409);
        const id = crypto.randomUUID();
        await store.query(
          "INSERT INTO shop_refund_requests (id,order_id,order_number,customer_id,reason,contact_phone,status) VALUES ($1,$2,$3,$4,$5,$6,'pending')",
          [id, order.id, order.order_number, order.customer_id || null, reason, contactPhone]
        );
        json(res, 201, { data: { request_id: id, status: 'pending', order_number: order.order_number } });
        return true;
      }
      if (pathname === '/site-admin-api/shop/shipping-quote' && req.method === 'POST') {
        const body = await bodyJson(req, 16384);
        const country = clean(body.country, 100);
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((item) => ({ id: clean(item?.id, 80), quantity: Math.max(1, Math.min(999, Number(item?.quantity) || 1)) })).filter((item) => item.id);
        if (!items.length) throw failure('购物车为空。', 400);
        const settings = (await store.query('SELECT shipping_mode,shipping_cents,shipping_zones,currency FROM shop_settings WHERE id=1')).rows[0];
        if (!settings) throw failure('店铺设置不可用。', 503);
        const ids = [...new Set(items.map((item) => item.id))];
        const rows = (await store.query('SELECT id,sku,name,shipping_rules FROM shop_products WHERE id = ANY($1::text[]) AND active=true', [ids])).rows;
        const byId = new Map(rows.map((row) => [row.id, row]));
        const lines = items.map((item) => byId.get(item.id)).filter(Boolean);
        if (lines.length !== items.length) throw failure('部分商品已下架，请刷新购物车。', 409);
        const quote = calculateCartShipping(settings, lines, country);
        json(res, 200, { data: { ...quote, currency: settings.currency || 'USD' } });
        return true;
      }
      if (pathname === '/site-admin-api/shop/orders' && req.method === 'POST') {
        if (checkoutAttempts.size > 2000) {
          for (const [address, times] of checkoutAttempts) {
            if (times.every((time) => Date.now() - time >= 15 * 60_000)) checkoutAttempts.delete(address);
          }
        }
        const input = orderInput(await bodyJson(req, 32768));
        // 反代场景下 socket 地址全是 127.0.0.1，会把整站的下单额度并成一个桶；
        // 统一走 requestIp（受 ADMIN_TRUST_PROXY 控制，且只信代理追加的那一跳）。
        const ip = String((requestIp ? requestIp(req) : '') || req.socket?.remoteAddress || 'unknown');
        const now = Date.now();
        const recent = (checkoutAttempts.get(ip) || []).filter((time) => now - time < 15 * 60_000);
        if (recent.length >= 6) {
          // 超频时先看看是不是重复提交：是就把原单原样返回，别让用户看到 429。
          const duplicated = await findRecentDuplicate((sql, params) => store.query(sql, params), input);
          if (duplicated) {
            json(res, 200, { data: { id: duplicated.id, order_number: duplicated.order_number, deduplicated: true, status: duplicated.status, payment_status: duplicated.payment_status, payment_provider: duplicated.payment_provider, shipping_status: duplicated.shipping_status } });
            return true;
          }
          throw failure('下单过于频繁，请稍后再试。', 429);
        }
        recent.push(now);
        checkoutAttempts.set(ip, recent);
        const customerSession = await customerForRequest(req);
        if (customerSession && customerSession.email.toLowerCase() !== input.email.toLowerCase()) throw failure('请使用当前账户邮箱完成下单。', 400);
        // 同意凭据：优先信任埋点写入的 HttpOnly 签名 Cookie（XSS 改不动），退回到前端时间戳。
        const consent = consentProof(req, input.consent_analytics_at);
        if (!consent.ok) throw failure(consent.message, 428);
        const buildOrder = async (client) => {
          const existing = await client.query('SELECT * FROM shop_orders WHERE idempotency_key = $1', [input.idempotency_key]);
          if (existing.rows[0]) {
            if (input.payment_provider && existing.rows[0].payment_provider !== input.payment_provider) throw failure('该订单请求标识已用于另一种支付方式，请重新提交。', 409);
            return existing.rows[0];
          }
          const duplicate = await findRecentDuplicate((sql, params) => client.query(sql, params), input);
          if (duplicate) return { ...duplicate, deduplicated: true };
          const settings = (await client.query('SELECT * FROM shop_settings WHERE id = 1')).rows[0];
          if (!settings?.checkout_enabled) throw failure('当前暂停下单，请联系客服。', 503);
          const selectedProvider = input.payment_provider || settings.payment_provider || 'manual';
          if (!PAYMENT_PROVIDERS.has(selectedProvider)) throw failure('不支持的支付方式。');
          if (selectedProvider !== 'manual' && (settings.currency || 'USD') !== 'USD') throw failure('Stripe 和 PayPal 当前只支持 USD 结算。', 409);
          const lines = [];
          for (const line of [...input.items].sort((a, b) => a.id.localeCompare(b.id))) {
            const selected = await client.query('SELECT id,sku,name,price_cents,currency,image_url,stock,allow_backorder,shipping_rules FROM shop_products WHERE id=$1 AND active=true FOR UPDATE', [line.id]);
            const product = selected.rows[0];
            if (!product || (product.stock < line.quantity && !product.allow_backorder)) throw failure('商品已下架或库存不足，请刷新购物车。', 409);
            const reservedQuantity = Math.min(product.stock, line.quantity);
            if (reservedQuantity > 0) await client.query('UPDATE shop_products SET stock=stock-$2,updated_at=now() WHERE id=$1', [product.id, reservedQuantity]);
            lines.push({ ...product, stock_reserved_quantity: reservedQuantity, quantity: line.quantity, line_total_cents: product.price_cents * line.quantity });
          }
          const subtotal = lines.reduce((sum, line) => sum + line.line_total_cents, 0);
          if (lines.some((line) => line.currency !== (settings.currency || 'USD'))) throw failure('商品货币和店铺结算货币不一致，请在后台调整后再下单。', 409);
          const shippingQuote = calculateCartShipping(settings, lines, input.shipping_address.country);
          // 人工报价/到付类订单允许游客下单，但必须在订单里留下可回复的邮箱。
          if (shippingQuote.manual && !customerSession && !input.email) throw failure('需要人工报价的订单请留下可回复的邮箱。', 400);
          if (shippingQuote.manual && selectedProvider !== 'manual') throw failure('该商品或收货地区需要人工确认运费，不能直接在线付款。', 409);
          if (!await paymentConfigured(selectedProvider)) throw failure('所选支付通道尚未完成凭据和 Webhook 配置。', 503);
          const shipping = Number(shippingQuote.shipping_cents || 0);
          if (subtotal + shipping > 2_147_483_647) throw failure('订单金额超出允许范围。');
          if (subtotal + shipping !== input.expected_total_cents) throw failure('商品价格或运费已变化，请刷新购物车后确认金额。', 409);
          const id = crypto.randomUUID();
          const number = `HM${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          const inserted = await client.query(
            `INSERT INTO shop_orders (id, order_number, idempotency_key, customer_name, email, phone, shipping_address, items, subtotal_cents, shipping_cents, total_cents, note, currency, payment_provider, payment_status, customer_id, legal_name, shipping_status, consent_analytics_at, cart_nonce)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
            [id, number, input.idempotency_key, input.customer_name, input.email, input.phone, JSON.stringify(input.shipping_address), JSON.stringify(lines), subtotal, shipping, subtotal + shipping, input.note, settings.currency || 'USD', selectedProvider, selectedProvider === 'manual' ? 'unpaid' : 'pending', customerSession?.id || null, clean(input.legal_name, 120) || customerSession?.legal_name || '', shippingQuote.shipping_status, input.consent_analytics_at ? new Date(String(input.consent_analytics_at)) : null, input.cart_nonce]
          );
          await client.query('INSERT INTO shop_order_events (order_id, action, detail) VALUES ($1,$2,$3::jsonb)', [id, 'created', JSON.stringify({ total_cents: subtotal + shipping, shipping_status: shippingQuote.shipping_status, shipping_breakdown: shippingQuote.breakdown })]);
          return { ...inserted.rows[0], payment_customer_id: customerSession?.payment_customer_id || '' };
        };
        let order;
        try {
          order = await store.withTransaction(buildOrder);
        } catch (error) {
          // 并发双击时两次请求都可能越过上面的幂等查询，撞到唯一键：回读那一单，别把第二次当失败。
          if (String(error?.code) === '23505' || /duplicate key/i.test(String(error?.message))) {
            const raced = (await store.query('SELECT * FROM shop_orders WHERE idempotency_key = $1', [input.idempotency_key])).rows[0];
            if (raced) order = { ...raced, deduplicated: true };
            else throw error;
          } else throw error;
        }
        let checkoutUrl = '';
        if (order.payment_provider && order.payment_provider !== 'manual' && order.payment_status !== 'paid') {
          try {
            const session = await createPaymentLink(order, order.payment_provider, await paymentSecrets()); checkoutUrl = session.url;
            await store.query("UPDATE shop_orders SET provider_payment_id=$2,checkout_url=$3,payment_status='pending',updated_at=now() WHERE id=$1", [order.id, session.id, session.url]);
          } catch (paymentError) {
            await store.withTransaction(async (client) => {
              const current = (await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE', [order.id])).rows[0];
              if (!current || current.status !== 'pending' || current.payment_status === 'paid') return;
              for (const item of current.items) {
                const restoreQuantity = Number.isSafeInteger(item.stock_reserved_quantity) ? item.stock_reserved_quantity : item.quantity;
                if (restoreQuantity > 0) await client.query('UPDATE shop_products SET stock=stock+$2,updated_at=now() WHERE id=$1', [item.id,restoreQuantity]);
              }
              await client.query("UPDATE shop_orders SET status='cancelled',payment_status='failed',updated_at=now() WHERE id=$1", [order.id]);
              await client.query('INSERT INTO shop_order_events (order_id,action,detail,actor) VALUES ($1,$2,$3::jsonb,$4)', [order.id, 'payment.setup.failed', JSON.stringify({ provider: order.payment_provider }), 'system']);
            });
            json(res, paymentError.status || 502, { error: { message: paymentError.message || '无法创建在线付款。', order_number: order.order_number } }); return true;
          }
        }
        json(res, order.deduplicated ? 200 : 201, { data: { id: order.id, order_number: order.order_number, deduplicated: Boolean(order.deduplicated), status: order.status, payment_status: order.payment_status, payment_provider: order.payment_provider, shipping_status: order.shipping_status, subtotal_cents: order.subtotal_cents, shipping_cents: order.shipping_cents, checkout_url: checkoutUrl, total_cents: order.total_cents, currency: order.currency } });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/products' && req.method === 'GET') {
        const rows = await store.query('SELECT * FROM shop_products ORDER BY sort_order, created_at DESC');
        json(res, 200, { data: rows.rows });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/products' && req.method === 'POST') {
        const item = productInput(await bodyJson(req, 65536));
        const saved = await store.query(`INSERT INTO shop_products (id,sku,slug,category,name,summary,description,image_url,gallery,highlights,specifications,faqs,videos,price_cents,currency,stock,allow_backorder,active,featured,sort_order,shipping_rules)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21::jsonb) RETURNING *`,
          [item.id,item.sku,item.slug,item.category,item.name,item.summary,item.description,item.image_url,JSON.stringify(item.gallery),JSON.stringify(item.highlights),JSON.stringify(item.specifications),JSON.stringify(item.faqs),JSON.stringify(item.videos),item.price_cents,item.currency,item.stock,item.allow_backorder,item.active,item.featured,item.sort_order,JSON.stringify(item.shipping_rules)]);
        await auditEvent(req, 'commerce.product.created', 'shop-product', item.id, { sku: item.sku });
        scheduleStorefrontTranslation();
        json(res, 201, { data: saved.rows[0] });
        return true;
      }
      const productMatch = pathname.match(/^\/site-admin-api\/commerce\/products\/([^/]+)$/);
      if (productMatch && req.method === 'PUT') {
        const item = productInput({ ...(await bodyJson(req, 65536)), id: productMatch[1] });
        const saved = await store.query(`UPDATE shop_products SET sku=$2,slug=$3,category=$4,name=$5,summary=$6,description=$7,image_url=$8,gallery=$9::jsonb,highlights=$10::jsonb,specifications=$11::jsonb,faqs=$12::jsonb,videos=$13::jsonb,price_cents=$14,currency=$15,stock=$16,allow_backorder=$17,active=$18,featured=$19,sort_order=$20,shipping_rules=$21::jsonb,updated_at=now() WHERE id=$1 RETURNING *`,
          [item.id,item.sku,item.slug,item.category,item.name,item.summary,item.description,item.image_url,JSON.stringify(item.gallery),JSON.stringify(item.highlights),JSON.stringify(item.specifications),JSON.stringify(item.faqs),JSON.stringify(item.videos),item.price_cents,item.currency,item.stock,item.allow_backorder,item.active,item.featured,item.sort_order,JSON.stringify(item.shipping_rules)]);
        if (!saved.rows[0]) throw failure('商品不存在。', 404);
        await auditEvent(req, 'commerce.product.updated', 'shop-product', item.id, { sku: item.sku });
        scheduleStorefrontTranslation();
        json(res, 200, { data: saved.rows[0] });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/orders' && req.method === 'GET') {
        const status = new URL(req.url, 'http://localhost').searchParams.get('status');
        if (status && !STATUSES.has(status)) throw failure('订单状态无效。');
        const rows = status
          ? await store.query('SELECT * FROM shop_orders WHERE status = $1 ORDER BY created_at DESC LIMIT 200', [status])
          : await store.query('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 200');
        const pendingRefunds = await store.query("SELECT id,order_id,order_number,reason,contact_phone,status,requested_at FROM shop_refund_requests WHERE status='pending' ORDER BY requested_at DESC").catch(() => ({ rows: [] }));
        const refundByOrder = new Map((pendingRefunds.rows || []).map((item) => [item.order_id, item]));
        json(res, 200, { data: rows.rows.map((order) => ({ ...order, refund_request: refundByOrder.get(order.id) || null })) });
        return true;
      }
      const refundMatch = pathname.match(/^\/site-admin-api\/commerce\/orders\/([^/]+)\/refund$/);
      if (refundMatch && req.method === 'POST') {
        const body = await bodyJson(req, 8192);
        if (typeof verifyAdminPassword !== 'function' || !(await verifyAdminPassword(body.email, body.password, req))) {
          throw failure('超级管理员账号或密码错误。', 403);
        }
        const order = (await store.query('SELECT * FROM shop_orders WHERE id=$1', [refundMatch[1]])).rows[0];
        if (!order) throw failure('订单不存在。', 404);
        if (!['paid', 'partially_refunded'].includes(order.payment_status)) throw failure('只有已付款或部分退款的订单可以继续退款。', 409);
        if (order.payment_provider !== 'stripe') throw failure('该订单不是 Stripe 付款，不能自动退款；请先在支付服务商后台处理。', 409);
        const totalCents = Number(order.total_cents || 0);
        const alreadyRefunded = Number(order.refunded_cents || 0);
        const remaining = Math.max(0, totalCents - alreadyRefunded);
        if (remaining <= 0) throw failure('该订单已全额退款。', 409);
        const requestedAmount = Object.hasOwn(body, 'amount_cents') ? Number(body.amount_cents) : remaining;
        if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0 || requestedAmount > remaining) {
          throw failure(`退款金额必须大于 0 且不超过剩余可退金额 ${(remaining / 100).toFixed(2)}。`, 400);
        }
        const secrets = await paymentSecrets();
        if (!secrets.stripeSecret) throw failure('Stripe Secret Key 未配置。', 503);
        let paymentIntent = String(order.provider_payment_id || '');
        if (paymentIntent.startsWith('cs_')) {
          const sessionResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(paymentIntent)}`, { headers: { Authorization: `Bearer ${secrets.stripeSecret}` } });
          const session = await sessionResponse.json();
          if (!sessionResponse.ok || !session.payment_intent) throw failure('无法找到 Stripe 付款记录。', 409);
          paymentIntent = String(session.payment_intent);
        }
        if (!paymentIntent) throw failure('订单缺少 Stripe 付款标识。', 409);
        const form = new URLSearchParams();
        form.set('payment_intent', paymentIntent);
        form.set('amount', String(requestedAmount));
        form.set('reason', 'requested_by_customer');
        form.set('metadata[order_id]', order.id);
        const refundResponse = await fetch('https://api.stripe.com/v1/refunds', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secrets.stripeSecret}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            // 同一订单、同一已退状态、同一金额视为同一次重试；多次部分退款会拿到不同 key。
            'Idempotency-Key': `refund-${order.id}-${alreadyRefunded}-${requestedAmount}`
          },
          body: form
        });
        const refund = await refundResponse.json().catch(() => ({}));
        if (!refundResponse.ok || !refund.id) throw failure(refund.error?.message || 'Stripe 退款失败。', 502);
        const processedBy = String(body.email || '').trim().toLowerCase();
        const saved = await store.withTransaction(async (client) => {
          const current = (await client.query('SELECT * FROM shop_orders WHERE id=$1 FOR UPDATE', [order.id])).rows[0];
          if (!current || !['paid', 'partially_refunded'].includes(current.payment_status)) throw failure('订单状态已变化，请刷新后重试。', 409);
          const currentRefunded = Number(current.refunded_cents || 0);
          const currentRemaining = Math.max(0, Number(current.total_cents) - currentRefunded);
          if (requestedAmount > currentRemaining) throw failure('剩余可退金额已变化，请刷新后重试。', 409);
          // Webhook 可能先一步把累计金额写入；只在尚未包含本次金额时累加，避免双重计数。
          const nextRefunded = currentRefunded > alreadyRefunded
            ? currentRefunded
            : Math.min(Number(current.total_cents), currentRefunded + requestedAmount);
          const nextPaymentStatus = nextRefunded >= Number(current.total_cents) ? 'refunded' : 'partially_refunded';
          const updated = (await client.query("UPDATE shop_orders SET payment_status=$2,refunded_cents=$3,refunded_at=now(),refunded_by=$4,updated_at=now() WHERE id=$1 RETURNING *", [order.id, nextPaymentStatus, nextRefunded, processedBy])).rows[0];
          const existing = (await client.query("SELECT id FROM shop_refund_requests WHERE order_id=$1 AND status='pending'", [order.id])).rows[0];
          const requestStatus = nextPaymentStatus === 'refunded' ? 'refunded' : 'partial';
          if (existing) {
            await client.query("UPDATE shop_refund_requests SET status=$2,processed_at=now(),processed_by=$3,refund_id=$4,admin_note=$5,refunded_cents=$6 WHERE id=$1", [existing.id, requestStatus, processedBy, refund.id, clean(body.reason, 1000), requestedAmount]);
          } else {
            await client.query("INSERT INTO shop_refund_requests (id,order_id,order_number,customer_id,reason,contact_phone,status,processed_at,processed_by,refund_id,admin_note,refunded_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11)", [crypto.randomUUID(), order.id, order.order_number, order.customer_id || null, clean(body.reason, 1200) || '后台退款', clean(order.phone, 80), requestStatus, processedBy, refund.id, clean(body.reason, 1000), requestedAmount]);
          }
          await client.query('INSERT INTO shop_order_events (order_id,action,detail,actor) VALUES ($1,$2,$3::jsonb,$4)', [order.id, 'payment.refunded', JSON.stringify({ refund_id: refund.id, amount_cents: requestedAmount, refunded_cents: nextRefunded, payment_status: nextPaymentStatus }), 'admin']);
          return updated;
        });
        await auditEvent(req, 'commerce.order.refunded', 'shop-order', order.id, { refund_id: refund.id, amount_cents: requestedAmount, refunded_cents: saved.refunded_cents, payment_status: saved.payment_status, processed_by: processedBy });
        json(res, 200, { data: saved });
        return true;
      }
      const orderMatch = pathname.match(/^\/site-admin-api\/commerce\/orders\/([^/]+)$/);
      if (orderMatch && req.method === 'PATCH') {
        const body = await bodyJson(req, 8192);
        const next = clean(body.status, 40);
        if (!STATUSES.has(next)) throw failure('订单状态无效。');
        const hasShippingQuote = Object.hasOwn(body, 'shipping_cents');
        const requestedShipping = hasShippingQuote ? Number(body.shipping_cents) : null;
        if (hasShippingQuote && (!Number.isSafeInteger(requestedShipping) || requestedShipping < 0 || requestedShipping > 2_147_483_647)) throw failure('运费报价必须为有效的非负整数分。');
        const tracking = clean(body.tracking_number, 120);
        const trackingUrl = clean(body.tracking_url, 2000);
        if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) throw failure('物流查询链接必须为 HTTPS。');
        const order = await store.withTransaction(async (client) => {
          const current = (await client.query('SELECT * FROM shop_orders WHERE id = $1 FOR UPDATE', [orderMatch[1]])).rows[0];
          if (!current) throw failure('订单不存在。', 404);
          const shippingStatus = current.shipping_status || 'included';
          const quotePending = shippingStatus === 'quote_pending';
          if (quotePending && !hasShippingQuote && ['confirmed', 'paid', 'fulfilling', 'shipped', 'completed'].includes(next)) throw failure('请先填写并保存运费报价，再确认或发货。', 409);
          if (quotePending && hasShippingQuote && ['confirmed', 'paid', 'fulfilling', 'shipped', 'completed'].includes(next)) throw failure('报价已保存后需要等待客户接受，再确认订单。', 409);
          if (shippingStatus === 'quoted' && !current.shipping_accepted_at && ['confirmed', 'paid', 'fulfilling', 'shipped', 'completed'].includes(next)) throw failure('请等待客户接受运费报价后再确认订单。', 409);
          if (hasShippingQuote && current.payment_status === 'paid' && requestedShipping !== current.shipping_cents) throw failure('已付款订单不能直接修改运费。');
          const nextShipping = hasShippingQuote ? requestedShipping : Number(current.shipping_cents || 0);
          const nextTotal = Number(current.subtotal_cents ?? current.total_cents) + Number(nextShipping);
          if (!Number.isSafeInteger(nextTotal) || nextTotal > 2_147_483_647) throw failure('运费报价后的订单金额超出允许范围。');
          if (current.status !== next && !NEXT_STATUS[current.status]?.has(next)) throw failure('订单不能从当前状态转为目标状态。', 409);
          if (quotePending && hasShippingQuote && ['confirmed', 'paid', 'fulfilling', 'shipped', 'completed'].includes(next) && current.status !== next && !NEXT_STATUS[current.status]?.has(next)) throw failure('运费报价已保存，请刷新订单后再处理状态。', 409);
          if (next === 'shipped' && !tracking && !current.tracking_number) throw failure('标记已发货前请填写物流单号。');
          if (next === 'cancelled' && current.status !== 'cancelled') {
            for (const item of current.items) {
              const restoreQuantity = Number.isSafeInteger(item.stock_reserved_quantity) ? item.stock_reserved_quantity : item.quantity;
              if (restoreQuantity > 0) await client.query('UPDATE shop_products SET stock=stock+$2 WHERE id=$1', [item.id, restoreQuantity]);
            }
          }
          const nextShippingStatus = quotePending && hasShippingQuote ? 'quoted' : shippingStatus;
          const saved = (await client.query("UPDATE shop_orders SET status=$2, payment_status=CASE WHEN $2='paid' THEN 'paid' WHEN $2='cancelled' AND payment_status<>'paid' THEN 'failed' ELSE payment_status END, tracking_number=$3, tracking_url=$4, shipping_cents=$5, total_cents=$6, shipping_status=$7, shipping_quoted_at=CASE WHEN $7='quoted' AND shipping_status='quote_pending' THEN now() ELSE shipping_quoted_at END, updated_at=now() WHERE id=$1 RETURNING *", [current.id, next, tracking || current.tracking_number, trackingUrl || current.tracking_url || '', nextShipping, nextTotal, nextShippingStatus])).rows[0];
          if (quotePending && hasShippingQuote) await client.query('INSERT INTO shop_order_events (order_id, action, detail, actor) VALUES ($1,$2,$3::jsonb,$4)', [current.id, 'shipping.quote.created', JSON.stringify({ shipping_cents: nextShipping, total_cents: nextTotal }), 'admin']);
          await client.query('INSERT INTO shop_order_events (order_id, action, detail, actor) VALUES ($1,$2,$3::jsonb,$4)', [current.id, 'status.changed', JSON.stringify({ from: current.status, to: next, tracking_number: saved.tracking_number, tracking_url: saved.tracking_url }), 'admin']);
          return saved;
        });
        await auditEvent(req, 'commerce.order.updated', 'shop-order', order.id, { status: next });
        json(res, 200, { data: order });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/settings' && req.method === 'GET') {
        const result = await store.query('SELECT shipping_mode,shipping_cents,shipping_zones,checkout_enabled,support_email,currency,payment_provider FROM shop_settings WHERE id = 1');
        const settings = result.rows[0] || {};
        const configured = await paymentConfigured(settings.payment_provider || 'manual');
        json(res, 200, { data: { ...settings, shipping_zones: normalizeShippingZones(settings.shipping_zones || []), currency: settings.currency || 'USD', payment_provider: settings.payment_provider || 'manual', payment_configured: configured } });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/settings' && req.method === 'PATCH') {
        const body = await bodyJson(req, 32768);
        const shipping = Number(body.shipping_cents);
        if (!Number.isSafeInteger(shipping) || shipping < 0 || shipping > 2_147_483_647) throw failure('运费必须为数据库允许的非负整数分。');
        const currency = ['USD', 'CNY'].includes(body.currency) ? body.currency : 'USD';
        const provider = ['manual', 'stripe', 'paypal'].includes(body.payment_provider) ? body.payment_provider : 'manual';
        const shippingMode = ['quote', 'flat'].includes(body.shipping_mode) ? body.shipping_mode : 'quote';
        const shippingZones = normalizeShippingZones(body.shipping_zones || []);
        const saved = await store.query('UPDATE shop_settings SET shipping_mode=$1,shipping_cents=$2,shipping_zones=$3::jsonb, checkout_enabled=$4, support_email=$5, currency=$6, payment_provider=$7, updated_at=now() WHERE id=1 RETURNING id,shipping_mode,shipping_cents,shipping_zones,checkout_enabled,support_email,currency,payment_provider,updated_at', [shippingMode, shipping, JSON.stringify(shippingZones), body.checkout_enabled === true, clean(body.support_email, 180), currency, provider]);
        const existing = await Promise.resolve(store.readRuntimeSetting ? store.readRuntimeSetting('shop-payments') : null).catch(() => null);
        const submittedSecrets = body.payment_secrets && typeof body.payment_secrets === 'object' ? body.payment_secrets : {};
        const nextSecrets = { ...(existing?.secrets || {}) };
        for (const key of ['stripeSecret', 'stripeWebhookSecret', 'paypalClientId', 'paypalClientSecret', 'paypalWebhookId']) {
          if (typeof submittedSecrets[key] === 'string' && submittedSecrets[key].trim()) nextSecrets[key] = submittedSecrets[key].trim().slice(0, 500);
        }
        if (Object.keys(nextSecrets).length) await store.saveRuntimeSetting?.('shop-payments', { config: {}, secrets: nextSecrets });
        await auditEvent(req, 'commerce.settings.updated', 'shop-settings', '1', { shipping_mode: shippingMode, shipping_cents: shipping });
        scheduleStorefrontTranslation();
        json(res, 200, { data: { ...saved.rows[0], payment_configured: await paymentConfigured(provider) } });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/policies' && req.method === 'GET') {
        if (!verifySession(req)) throw failure('请先登录。', 401);
        const result = await store.query('SELECT privacy_policy,cookie_policy,terms_policy,shipping_policy,returns_policy FROM shop_settings WHERE id=1');
        json(res, 200, { data: result.rows[0] || { privacy_policy: '', cookie_policy: '', terms_policy: '', shipping_policy: '', returns_policy: '' } }); return true;
      }
      if (pathname === '/site-admin-api/commerce/policies' && req.method === 'PATCH') {
        const body = await bodyJson(req, 30000);
        const policy = ['privacy_policy','cookie_policy','terms_policy','shipping_policy','returns_policy'].map((key) => clean(body[key], 12000));
        const result = await store.query('UPDATE shop_settings SET privacy_policy=$1,cookie_policy=$2,terms_policy=$3,shipping_policy=$4,returns_policy=$5,updated_at=now() WHERE id=1 RETURNING privacy_policy,cookie_policy,terms_policy,shipping_policy,returns_policy', policy);
        await auditEvent(req, 'commerce.policies.updated', 'shop-policies', '1', {});
        scheduleStorefrontTranslation();
        json(res, 200, { data: result.rows[0] }); return true;
      }
      if (pathname === '/site-admin-api/commerce/storefront' && req.method === 'GET') {
        const result = await store.query('SELECT storefront_content FROM shop_settings WHERE id=1');
        json(res, 200, { data: result.rows[0]?.storefront_content || {} }); return true;
      }
      if (pathname === '/site-admin-api/commerce/storefront' && req.method === 'PATCH') {
        const body = await bodyJson(req, 60000);
        const content = body && typeof body === 'object' && body.content && typeof body.content === 'object' && !Array.isArray(body.content) ? body.content : {};
        const checkMedia = (value, key = '') => {
          if (Array.isArray(value)) return value.forEach((item) => checkMedia(item, key));
          if (value && typeof value === 'object') return Object.entries(value).forEach(([childKey, childValue]) => checkMedia(childValue, childKey));
          if (typeof value === 'string' && /(image|video|url)$/i.test(key) && value.trim() && !(value.trim().startsWith('/') && !value.trim().startsWith('//')) && !/^https:\/\//i.test(value.trim())) throw failure(`${key} 仅允许 HTTPS 或站内路径。`);
          if (typeof value === 'string' && /(?:href|link)$/i.test(key) && value.trim() && !(value.trim().startsWith('/') && !value.trim().startsWith('//')) && !/^https:\/\//i.test(value.trim())) throw failure(`${key} 仅允许 HTTPS 链接或站内路径。`);
        };
        checkMedia(content);
        const serialized = JSON.stringify(content);
        if (serialized.length > 50000) throw failure('网站页面配置最多 50 KB。');
        const saved = await store.query('UPDATE shop_settings SET storefront_content=$1::jsonb,updated_at=now() WHERE id=1 RETURNING storefront_content', [serialized]);
        await auditEvent(req, 'commerce.storefront.updated', 'storefront-content', '1', { keys: Object.keys(content) });
        scheduleStorefrontTranslation();
        json(res, 200, { data: saved.rows[0]?.storefront_content || {} }); return true;
      }
      if (pathname === '/site-admin-api/commerce/seo' && req.method === 'GET') {
        const content = await readStorefrontContent();
        json(res, 200, { data: normalizeStorefrontSeo(content.seo) });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/seo' && req.method === 'PATCH') {
        const body = await bodyJson(req, 120000);
        const content = await readStorefrontContent();
        const seo = normalizeStorefrontSeo(body?.seo);
        await saveStorefrontSeo(content, seo);
        await auditEvent(req, 'commerce.seo.updated', 'storefront-seo', '1', { pages: Object.keys(seo.pages) });
        scheduleStorefrontTranslation();
        json(res, 200, { data: seo });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/seo/ai-generate' && req.method === 'POST') {
        if (!storefrontSeoService) throw failure('SEO AI 服务不可用。', 503);
        const content = await readStorefrontContent();
        const [productsResult, policiesResult] = await Promise.all([
          store.query('SELECT name, category, summary FROM shop_products WHERE active=true ORDER BY featured DESC, sort_order ASC, created_at DESC LIMIT 20').catch(() => ({ rows: [] })),
          store.query('SELECT privacy_policy,cookie_policy,terms_policy,shipping_policy,returns_policy FROM shop_settings WHERE id=1').catch(() => ({ rows: [] }))
        ]);
        let generated;
        try {
          generated = await storefrontSeoService.generate({
            content,
            products: productsResult.rows || [],
            policies: policiesResult.rows[0] || {}
          });
        } catch (error) {
          if (String(error?.message || '').includes('SEO 模型没有返回')) throw failure(error.message, 502);
          if (error?.code === 'AI_UNCONFIGURED' || error?.code === 'TRANSLATION_UNCONFIGURED') {
            throw failure('SEO 模型未配置：请在「AI 能力 → 模型配置」绑定「SEO」能力。', 503);
          }
          throw failure(error?.message || 'SEO 生成失败。', 502);
        }
        const existing = normalizeStorefrontSeo(content.seo);
        const mergedPages = { ...existing.pages };
        for (const [key, value] of Object.entries(generated.pages || {})) {
          mergedPages[key] = { ...(mergedPages[key] || {}), ...value };
        }
        const seo = { pages: mergedPages };
        await saveStorefrontSeo(content, seo);
        await auditEvent(req, 'commerce.seo.ai-generated', 'storefront-seo', '1', { pages: Object.keys(generated.pages || {}) });
        scheduleStorefrontTranslation();
        json(res, 200, { data: seo, meta: { generated: generated.generated || Object.keys(generated.pages || {}).length } });
        return true;
      }
      if (pathname === '/site-admin-api/commerce/customers' && req.method === 'GET') {
        const search = clean(new URL(req.url || '/', 'http://localhost').searchParams.get('q'), 180);
        const paidTotals = "(SELECT COALESCE(jsonb_object_agg(paid.currency, paid.total_cents), '{}'::jsonb) FROM (SELECT currency, sum(total_cents)::bigint AS total_cents FROM shop_orders WHERE customer_id=c.id AND payment_status='paid' GROUP BY currency) paid) AS paid_totals";
        const customerAddresses = "(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'recipient',a.recipient,'phone',a.phone,'country',a.country,'region',a.region,'city',a.city,'line1',a.line1,'line2',a.line2,'postal_code',a.postal_code,'is_default',a.is_default) ORDER BY a.is_default DESC,a.created_at DESC), '[]'::jsonb) FROM shop_customer_addresses a WHERE a.customer_id=c.id) AS addresses";
        const result = search
          ? await store.query(`SELECT c.id,c.email,c.full_name,c.phone,c.legal_name,c.verification_status,c.created_at,count(o.id)::int AS order_count,${paidTotals},${customerAddresses} FROM shop_customers c LEFT JOIN shop_orders o ON o.customer_id=c.id WHERE c.email ILIKE $1 OR c.full_name ILIKE $1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`, [`%${search}%`])
          : await store.query(`SELECT c.id,c.email,c.full_name,c.phone,c.legal_name,c.verification_status,c.created_at,count(o.id)::int AS order_count,${paidTotals},${customerAddresses} FROM shop_customers c LEFT JOIN shop_orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`);
        json(res, 200, { data: result.rows }); return true;
      }
      const customerMatch = pathname.match(/^\/site-admin-api\/commerce\/customers\/([^/]+)$/);
      if (customerMatch && req.method === 'PATCH') {
        const body = await bodyJson(req, 8192);
        const fullName = clean(body.full_name, 120); if (!fullName) throw failure('客户姓名不能为空。');
        const result = await store.query('UPDATE shop_customers SET full_name=$2,phone=$3,legal_name=$4,updated_at=now() WHERE id=$1 RETURNING id,email,full_name,phone,legal_name,verification_status,created_at', [customerMatch[1],fullName,clean(body.phone,60),clean(body.legal_name,120)]);
        if (!result.rows[0]) throw failure('客户不存在。', 404);
        await auditEvent(req, 'commerce.customer.updated', 'shop-customer', customerMatch[1], {});
        json(res, 200, { data: result.rows[0] }); return true;
      }
      json(res, 405, { error: { message: '不支持的商城接口或方法。' } });
      return true;
    } catch (error) {
      const status = error.status || (error.code === '23505' ? 409 : 500);
      json(res, status, { error: { message: status === 500 ? '商城操作失败，请稍后重试。' : error.message } });
      return true;
    }
  };
}

export { orderInput, productInput };
