import {
  cloneElement,
  createContext,
  createElement,
  isValidElement,
  useContext,
  type ReactElement,
  type ReactNode
} from 'react';
import arDictionary from './dictionaries/ar.json';
import zhDictionary from './dictionaries/zh-CN.json';
import { englishServerMessage } from './server-messages';

export type Locale = 'en' | 'zh-CN' | 'ar';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'zh-CN', 'ar'];

const dictionaries: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  'zh-CN': zhDictionary as Record<string, string>,
  ar: arDictionary as Record<string, string>
};

/**
 * Arabic copy used to be matched as substrings because some CMS strings mixed
 * translated and untranslated fragments. Keep that behaviour for Arabic only;
 * Chinese uses exact keys plus the explicit runtime patterns below.
 */
const arEntries = Object.entries(dictionaries.ar).sort(([left], [right]) => right.length - left.length);

export function normalizeLocale(value: unknown): Locale {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh_cn') return 'zh-CN';
  if (normalized === 'ar' || normalized.startsWith('ar-') || normalized.startsWith('ar_')) return 'ar';
  return 'en';
}

export function htmlLang(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en-US';
}

export function localePrefix(locale: Locale): string {
  return locale === 'zh-CN' ? '/zh' : locale === 'ar' ? '/ar' : '';
}

/** Locale-aware equivalent of an internal path. External URLs and hashes are untouched. */
export function localizeHref(locale: Locale, href: string): string {
  if (locale === 'en' || !href || !href.startsWith('/') || href.startsWith('//')) return href;
  if (/^\/(?:zh|ar)(?:\/|$)/.test(href)) return href;
  if (/^\/(?:assets|_astro|site-admin-api|api|uploads|__preview|favicon|robots|sitemap)(?:\/|$|\.)/.test(href)) return href;
  const [, pathname = '/', suffix = ''] = href.match(/^([^?#]*)(.*)$/) || [];
  if (pathname === '/') return `${localePrefix(locale)}/${suffix}`;
  return `${localePrefix(locale)}${pathname}${suffix}`;
}

function translatePattern(locale: Exclude<Locale, 'en'>, value: string): string | null {
  if (locale === 'zh-CN') {
    let match = value.match(/^(\d+) in stock$/);
    if (match) return `${match[1]} 件现货`;
    match = value.match(/^Cart: (\d+) items?$/);
    if (match) return `购物车：${match[1]} 件`;
    match = value.match(/^Add (.+) to cart$/);
    if (match) return `将 ${translate('zh-CN', match[1])} 加入购物车`;
    match = value.match(/^View (.+)$/);
    if (match) return `查看 ${translate('zh-CN', match[1])}`;
    match = value.match(/^Remove (.+)$/);
    if (match) return `移除 ${translate('zh-CN', match[1])}`;
    match = value.match(/^Watch (.+)$/);
    if (match) return `观看 ${translate('zh-CN', match[1])}`;
    match = value.match(/^Show item (\d+)$/);
    if (match) return `显示第 ${match[1]} 项`;
    match = value.match(/^Shipping is (.+)\. Your final total is shown at checkout\.$/);
    if (match) return `运费为 ${match[1]}，最终总额将在结账时显示。`;
    match = value.match(/^Payment will be securely processed by (.+)\.$/);
    if (match) return `付款将由 ${match[1]} 安全处理。`;
    match = value.match(/^Resend in (\d+)s$/);
    if (match) return `${match[1]} 秒后可重发`;
    return null;
  }

  // Arabic: preserve the historical fragment-replacement fallback, then handle
  // the same runtime labels as the other locales.
  if (/[A-Za-z\u3400-\u9fff]/u.test(value)) {
    let expanded = value;
    for (const [source, translation] of arEntries) {
      if (source.length < 9 || !expanded.includes(source)) continue;
      expanded = expanded.replaceAll(source, translation);
    }
    if (expanded !== value) return expanded;
  }
  let match = value.match(/^Cart: (\d+) items?$/i);
  if (match) return `سلة التسوق (${match[1]})`;
  match = value.match(/^Add (.+) to cart$/i);
  if (match) return `أضف ${translate('ar', match[1])} إلى السلة`;
  match = value.match(/^View (.+)$/i);
  if (match) return `عرض ${translate('ar', match[1])}`;
  match = value.match(/^Remove (.+)$/i);
  if (match) return `إزالة ${translate('ar', match[1])}`;
  match = value.match(/^(\d+) in stock$/i);
  if (match) return `${match[1]} متوفر في المخزون`;
  match = value.match(/^Show item (\d+)$/i);
  if (match) return `عرض العنصر ${match[1]}`;
  match = value.match(/^Shipping is (.+)\. Your final total is shown at checkout\.$/);
  if (match) return `الشحن ${match[1]}. يظهر الإجمالي النهائي عند إتمام الطلب.`;
  match = value.match(/^Payment will be securely processed by (.+)\.$/);
  if (match) return `ستتم معالجة الدفع بأمان عبر ${match[1]}.`;
  match = value.match(/^Resend in (\d+)s$/i);
  if (match) return `إعادة الإرسال بعد ${match[1]} ثانية`;
  return null;
}

/** Memoized because the same UI strings are re-localized on every keystroke. */
const translationCache = new Map<string, string>();

/** Translate a complete UI string. English is the source language and is returned unchanged. */
export function translate(locale: Locale, value: string): string {
  if (locale === 'en' || !value) return value;
  const cacheKey = `${locale}\u0000${value}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const dictionary = dictionaries[locale];
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const core = value.slice(leading.length, value.length - trailing.length);
  if (!core) return value;
  const translated = dictionary[core] || translatePattern(locale, core);
  const result = !translated || translated === core ? value : `${leading}${translated}${trailing}`;
  if (translationCache.size > 5000) translationCache.clear();
  translationCache.set(cacheKey, result);
  return result;
}

/**
 * Backend errors are Chinese. 常用的那些有英文对照表，翻不出来的才退回兜底文案，
 * 这样英文/阿语页面也不会只剩一句笼统的「请求失败」。
 */
export function localizedServerMessage(locale: Locale, message: unknown, fallback: string): string {
  const text = String(message || '').trim();
  if (!text) return translate(locale, fallback);
  const throttle = text.match(/请 (\d+) 秒后/);
  if (throttle && locale !== 'zh-CN') return `Please wait ${throttle[1]}s before requesting a new code.`;
  if (locale !== 'zh-CN' && /[\u3400-\u9fff]/u.test(text)) {
    const english = englishServerMessage(text);
    return english ? translate(locale, english) : translate(locale, fallback);
  }
  const translated = translate(locale, text);
  if (locale !== 'zh-CN' && translated === text && /[A-Za-z]{3,}/u.test(text)) return translate(locale, fallback);
  return translated;
}

const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'alt'] as const;

/**
 * Localize a React tree once, on the server and during hydration, instead of
 * mutating the DOM after hydration. Deterministic output keeps hydration
 * consistent and removes the flash of English on /zh/ and /ar/.
 */
export function localizeReact(node: ReactNode, locale: Locale): ReactNode {
  if (locale === 'en' || node === null || node === undefined || typeof node === 'boolean') return node;
  if (typeof node === 'string') return translate(locale, node);
  if (typeof node === 'number') return node;
  if (Array.isArray(node)) {
    const localized = node.map((child) => localizeReact(child, locale));
    return localized.every((child, index) => child === node[index]) ? node : localized;
  }
  if (!isValidElement(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const props: Record<string, unknown> = { ...element.props };
  let changed = false;

  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const value = props[attribute];
    if (typeof value !== 'string') continue;
    const translated = translate(locale, value);
    if (translated !== value) {
      props[attribute] = translated;
      changed = true;
    }
  }

  if (element.type === 'a' && typeof props.href === 'string') {
    const localized = localizeHref(locale, props.href);
    if (localized !== props.href) {
      props.href = localized;
      changed = true;
    }
  }

  if (props.children !== undefined) {
    const localizedChildren = localizeReact(props.children as ReactNode, locale);
    if (localizedChildren !== props.children) {
      props.children = localizedChildren;
      changed = true;
    }
  }

  return changed ? cloneElement(element, props) : element;
}

export interface TranslatableProduct {
  sku?: string;
  slug?: string;
  category?: string;
  name?: string;
  summary?: string;
  description?: string;
  highlights?: string[];
  specifications?: Array<{ label: string; value: string }>;
  faqs?: Array<{ question: string; answer: string }>;
}

const localizedProductFallback = {
  'zh-CN': {
    category: '工程机械属具',
    detail: '请联系我们的团队获取商品详情，中文资料正在整理中。',
    summary: '商品中文信息正在整理中，欢迎联系我们了解详情。'
  },
  ar: {
    category: 'ملحقات المعدات',
    detail: 'يرجى التواصل مع فريقنا للحصول على تفاصيل المنتج، فالمحتوى العربي قيد الإعداد.',
    summary: 'المعلومات العربية للمنتج قيد الإعداد. تواصل معنا لمعرفة التفاصيل.'
  }
} as const;

function hasLatinCopy(value: string): boolean {
  return /[A-Za-z]{3,}/.test(value) && !/[\u3400-\u9fff]/u.test(value);
}

/**
 * Translate product fields fetched from the commerce API before they enter
 * React state, so a localized page never renders English product copy while a
 * translation job is pending.
 */
export function localizeProduct<T extends TranslatableProduct>(product: T, locale: Locale): T {
  if (locale === 'en' || !product) return product;
  const fallback = localizedProductFallback[locale];
  const sku = product.sku || product.slug || '';
  const pick = (source: string | undefined, fallbackText: string, generic: boolean) => {
    if (!source) return fallbackText;
    const translated = translate(locale, source);
    if (translated !== source) return translated;
    if (generic && hasLatinCopy(source)) return fallbackText;
    return translated;
  };

  return {
    ...product,
    category: pick(product.category, fallback.category, true),
    name: pick(product.name, `${sku} ${fallback.category}`.trim(), true),
    summary: pick(product.summary, fallback.summary, true),
    description: pick(product.description, fallback.detail, true),
    highlights: (product.highlights || []).map((item) => translate(locale, item)),
    specifications: (product.specifications || []).map((item) => ({
      label: translate(locale, item.label),
      value: translate(locale, item.value)
    })),
    faqs: (product.faqs || []).map((item) => ({
      question: translate(locale, item.question),
      answer: translate(locale, item.answer)
    }))
  };
}

export function formatMoney(cents: number, currency: 'USD' | 'CNY' = 'USD', locale: Locale = 'en'): string {
  const intlLocale = locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en-US';
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format((Number(cents) || 0) / 100);
}

export function formatDate(value: string | number | Date, locale: Locale = 'en'): string {
  const intlLocale = locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en-US';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return createElement(LocaleContext.Provider, { value: locale }, children);
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

