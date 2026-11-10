import { localizeProduct, type Locale } from '../i18n';
import type { Product } from './storefront-types';

export interface StorefrontBootstrap {
  copy: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  policies: Record<string, string> | null;
}

const hasChinese = (value: unknown) => typeof value === 'string' && /[\u3400-\u9fff]/u.test(value);
const hasArabic = (value: unknown) => typeof value === 'string' && /[\u0600-\u06ff]/u.test(value);
const containsChinese = (value: unknown): boolean => {
  if (hasChinese(value)) return true;
  if (Array.isArray(value)) return value.some(containsChinese);
  if (value && typeof value === 'object') return Object.values(value).some(containsChinese);
  return false;
};

const containsArabic = (value: unknown): boolean => {
  if (hasArabic(value)) return true;
  if (Array.isArray(value)) return value.some(containsArabic);
  if (value && typeof value === 'object') return Object.values(value).some(containsArabic);
  return false;
};


/**
 * 按语言挑字段：英文/阿语站不能用中文文案，但也不能因为某一个字段是中文
 * 就把整份 CMS 内容丢掉（历史行为：英文站的公告、SEO 会静默失效）。
 */
function omitStringsNotIn(value: unknown, keep: (text: string) => boolean): unknown {
  // 站内路径与外链是语言中性的，任何语言都要保留。
  if (typeof value === 'string') return keep(value) || /^(\/|https?:\/\/)/.test(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => omitStringsNotIn(item, keep)).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = omitStringsNotIn(item, keep);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

const isEnglishCopy = (text: string) => !hasChinese(text) && !hasArabic(text);

const API = String(import.meta.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');
const cache = new Map<Locale, Promise<StorefrontBootstrap>>();

async function json(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'Cache-Control': 'no-store' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Load the CMS copy and shop settings while the page is built, so the first
 * paint already shows the published copy. The browser still refreshes both
 * after hydration; this only removes the visible swap from default copy to
 * CMS copy on every page load.
 */
export async function loadStorefrontBootstrap(locale: Locale): Promise<StorefrontBootstrap> {
  const cached = cache.get(locale);
  if (cached && !import.meta.env.DEV) return cached;
  const task = (async () => {
    const query = locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en';
    const [storefront, settings, translation, policies] = await Promise.all([
      json(`${API}/site-admin-api/shop/storefront?locale=${query}`),
      json(`${API}/site-admin-api/shop/settings`),
      json(`${API}/site-admin-api/shop/translated-content?locale=${query}`),
      json(`${API}/site-admin-api/shop/policies?locale=${query}`)
    ]);

    const ready = translation?.meta?.status === 'ready' ? translation.data : null;
    const sourceCopy = storefront?.data;
    let copy: Record<string, unknown> | null = null;
    if (ready?.storefront) copy = ready.storefront;
    else if (locale === 'en' && sourceCopy) copy = omitStringsNotIn(sourceCopy, isEnglishCopy) as Record<string, unknown> | null;
    else if (locale === 'zh-CN' && containsChinese(sourceCopy)) copy = sourceCopy;
    else if (locale === 'ar' && sourceCopy) copy = omitStringsNotIn(sourceCopy, hasArabic) as Record<string, unknown> | null;

    // Social profile URLs are language-neutral and must survive the
    // "CMS copy is not in this language" branch above.
    const social = [ready?.storefront?.social, sourceCopy?.social]
      .find((value) => value && typeof value === 'object' && Object.values(value).some((item) => typeof item === 'string' && item.trim())) as Record<string, unknown> | undefined;
    if (social && Object.values(social).some((value) => typeof value === 'string' && value.trim())) {
      copy = { ...(copy || {}), social: { ...((copy?.social as Record<string, unknown>) || {}), ...social } };
    }

    let localizedPolicies: Record<string, string> | null = null;
    if (ready?.policies) localizedPolicies = ready.policies;
    else if (policies?.data) {
      const entries = Object.entries(policies.data).filter(([, text]) => {
        if (typeof text !== 'string' || !text.trim()) return false;
        if (locale === 'zh-CN') return hasChinese(text);
        if (locale === 'ar') return hasArabic(text);
        return !hasChinese(text) && !hasArabic(text);
      });
      if (entries.length) localizedPolicies = Object.fromEntries(entries) as Record<string, string>;
    }

    return { copy, settings: settings?.data || null, policies: localizedPolicies };
  })();
  cache.set(locale, task);
  return task;
}

const detailCache = new Map<string, Promise<Product | null>>();

/** Build-time product detail so the static product page ships real content, not a loading placeholder. */
export async function loadProductDetail(locale: Locale, slug: string): Promise<Product | null> {
  const key = `${locale}:${slug}`;
  const cached = detailCache.get(key);
  if (cached && !import.meta.env.DEV) return cached;
  const task = (async () => {
    const query = locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en';
    const payload = await json(`${API}/site-admin-api/shop/products/${encodeURIComponent(slug)}?locale=${query}`);
    const product = payload?.data as Product | undefined;
    if (!product) return null;
    return locale === 'en' ? product : localizeProduct(product, locale);
  })();
  detailCache.set(key, task);
  return task;
}

const productListCache = new Map<Locale, Promise<Product[]>>();

/** Build-time catalog so home/shop pages render product cards instead of a loading placeholder. */
export async function loadStorefrontProducts(locale: Locale): Promise<Product[]> {
  const cached = productListCache.get(locale);
  if (cached && !import.meta.env.DEV) return cached;
  const task = (async () => {
    const query = locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en';
    const payload = await json(`${API}/site-admin-api/shop/products?locale=${query}`);
    const products = (payload?.data || []) as Product[];
    return locale === 'en' ? products : products.map((product) => localizeProduct(product, locale));
  })();
  productListCache.set(locale, task);
  return task;
}
