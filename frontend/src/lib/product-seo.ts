import { translate } from '../i18n';

export type SeoLocale = 'en' | 'zh-CN' | 'ar';

export interface SeoProduct {
  name: string;
  summary: string;
  sku: string;
  slug: string;
  image: string;
  price: number;
  currency: 'USD' | 'CNY';
  availability: 'InStock' | 'BackOrder' | 'OutOfStock';
}

interface ProductRecord {
  name?: string;
  summary?: string;
  sku?: string;
  slug?: string;
  image_url?: string;
  price_cents?: number;
  currency?: 'USD' | 'CNY';
  stock?: number;
  allow_backorder?: boolean;
}

function localizedFallback(record: ProductRecord, locale: SeoLocale) {
  const sku = record.sku || record.slug || 'equipment';
  if (locale === 'zh-CN') {
    return { name: `${sku} 工程机械属具`, summary: `查看 ${sku} 的工程机械属具详情、价格、规格与配送信息。` };
  }
  if (locale === 'ar') {
    return { name: `${sku} ملحقات المعدات`, summary: `تعرف على مواصفات ${sku} وسعره وخيارات الشحن والشراء من Hongmeng Machinery.` };
  }
  return { name: `${sku} equipment attachment`, summary: `View specifications, price, shipping, and purchasing information for ${sku} from Hongmeng Machinery.` };
}

function hasLocaleText(value: string, locale: SeoLocale) {
  if (locale === 'zh-CN') return /[\u3400-\u9fff]/u.test(value);
  if (locale === 'ar') return /[\u0600-\u06ff]/u.test(value);
  return !/[\u3400-\u9fff\u0600-\u06ff]/u.test(value);
}

function fallbackImage(record: ProductRecord) {
  const identity = `${record.sku || ''} ${record.slug || ''} ${record.name || ''}`.toLowerCase();
  if (/hm46|mm46|46-inch/u.test(identity)) return '/assets/generated/product-hm46.webp';
  if (/tooth|teeth|cutter/u.test(identity)) return '/assets/generated/product-teeth.webp';
  if (/belt/u.test(identity)) return '/assets/generated/product-belt.webp';
  if (/bracket|holder/u.test(identity)) return '/assets/generated/product-brackets.webp';
  return '/assets/generated/product-hm38.webp';
}

export async function loadSeoProducts(locale: SeoLocale): Promise<SeoProduct[]> {
  const apiBase = String(import.meta.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');
  try {
    const response = await fetch(`${apiBase}/site-admin-api/shop/products?locale=${encodeURIComponent(locale)}`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'Cache-Control': 'no-store' }
    });
    if (!response.ok) return [];
    const result = await response.json() as { data?: ProductRecord[] };
    return (result.data || []).filter((record) => record.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.slug)).map((record) => {
      const fallback = localizedFallback(record, locale);
      const translatedName = record.name ? translate(locale, record.name) : '';
      const translatedSummary = record.summary ? translate(locale, record.summary) : '';
      const name = translatedName && hasLocaleText(translatedName, locale) ? translatedName : fallback.name;
      const summary = translatedSummary && hasLocaleText(translatedSummary, locale) ? translatedSummary : fallback.summary;
      const stock = Number(record.stock || 0);
      return {
        name,
        summary: summary.replace(/\s+/gu, ' ').trim().slice(0, 300),
        sku: record.sku || record.slug || '',
        slug: record.slug!,
        image: record.image_url || fallbackImage(record),
        price: Number(record.price_cents || 0) / 100,
        currency: record.currency || 'USD',
        availability: stock > 0 ? 'InStock' : record.allow_backorder ? 'BackOrder' : 'OutOfStock'
      };
    });
  } catch {
    // A static build can run without the optional commerce API; runtime detail
    // routing still serves the shared product shell for newly added products.
    return [];
  }
}
