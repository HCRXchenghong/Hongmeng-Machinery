import crypto from 'node:crypto';
import { collectTranslatableEntries } from './website-translation-service.mjs';

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'ar'];

function normalizeLocale(locale) {
  const value = String(locale || 'en').trim().toLowerCase();
  if (value === 'zh' || value === 'zh-cn' || value === 'zh_cn' || value.startsWith('zh-')) return 'zh-CN';
  if (value === 'ar' || value.startsWith('ar-')) return 'ar';
  if (value === 'en' || value.startsWith('en-')) return 'en';
  return null;
}
const SETTING_KEYS = { en: 'storefront-translation-en', 'zh-CN': 'storefront-translation-zh-CN', ar: 'storefront-translation-ar' };

function setAtPath(target, path, value) {
  const keys = path.split('.');
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)] = value;
}

function publicProduct(row) {
  return {
    id: row.id, sku: row.sku, slug: row.slug, category: row.category, name: row.name,
    summary: row.summary, description: row.description, image_url: row.image_url,
    gallery: row.gallery || [], highlights: row.highlights || [],
    specifications: row.specifications || [], faqs: row.faqs || [], videos: row.videos || [],
    price_cents: Number(row.price_cents || 0), currency: row.currency || 'USD',
    stock: Number(row.stock || 0), allow_backorder: row.allow_backorder === true,
    available: Number(row.stock || 0) > 0 || row.allow_backorder === true,
    featured: row.featured === true
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function englishSourceEntries(content) {
  const entries = [];
  const skipKey = /^(id|sku|slug|categorySlug|locale|href|url|src|path|phone|email|icon|logoUrl|serviceBridgeUrl)$/i;
  const assetKey = /(image|video|media|asset|cover|poster|thumbnail|background|download|endpoint|key)$/i;
  const unitsOnly = /^\d[\d\s.,()–—/-]*(?:(?:mm|cm|m|in|inch(?:es)?|psi|mpa|l\/min|gpm|kg|lb|ft|rpm|v|a|hz)\b[\d\s.,()–—/-]*)+$/i;

  function visit(value, path = '') {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
      return;
    }
    if (typeof value !== 'string' || !/[A-Za-z]{2,}/.test(value)) return;
    if (/[\u3400-\u9fff]/u.test(value) && !/[A-Za-z]{4,}/.test(value)) return;
    const key = path.split('.').at(-1) || '';
    const trimmed = value.trim();
    if (skipKey.test(key) || assetKey.test(key) || /^(?:https?:|mailto:|tel:|\/|#)/i.test(trimmed) || unitsOnly.test(trimmed)) return;
    entries.push({ id: path, text: value });
  }

  visit(content);
  return entries;
}

function entriesForLocale(source, locale) {
  if (locale === 'zh-CN') return englishSourceEntries(source);
  if (locale === 'ar') {
    const byPath = new Map();
    for (const entry of [...collectTranslatableEntries(source), ...englishSourceEntries(source)]) byPath.set(entry.id, entry);
    return [...byPath.values()];
  }
  return collectTranslatableEntries(source);
}

function translationPrompt(entries, locale) {
  const direction = locale === 'en'
    ? 'Translate the following Simplified Chinese Hongmeng Machinery storefront content into natural, accurate English for a US industrial equipment ecommerce website.'
    : locale === 'ar'
      ? 'Translate the following Chinese or English Hongmeng Machinery storefront content into clear, natural Modern Standard Arabic for an industrial equipment ecommerce website serving Arabic-speaking customers.'
      : 'Translate the following English Hongmeng Machinery storefront content into clear, natural Simplified Chinese for a Chinese-language industrial equipment ecommerce website.';
  const brandRule = locale === 'en'
    ? 'Preserve the brand name Hongmeng Machinery as Hongmeng Machinery.'
    : locale === 'ar'
      ? 'Preserve the brand name Hongmeng Machinery in Latin characters. Preserve product models such as MM38 and MM46.'
      : 'Translate the brand name Hongmeng Machinery as 宏盟机械. Preserve product models such as MM38 and MM46.';
  return [
    direction,
    `Return only a JSON array with one object per input containing the same id and its translated text. Keep the order, ids, numbers, units, product models, HTML, placeholders, and line breaks. Preserve URLs. ${brandRule} Do not add claims or technical specifications.`,
    JSON.stringify(entries)
  ].join('\n');
}

export function createStorefrontTranslationService({ store, translationService, logger = console }) {
  const activeJobs = new Map();
  const activeRevisions = new Map();
  let jobSequence = 0;
  let running = Promise.resolve();

  async function sourceSnapshot() {
    const [products, settings] = await Promise.all([
      store.query('SELECT * FROM shop_products WHERE active = true ORDER BY sort_order, created_at DESC'),
      store.query('SELECT storefront_content,privacy_policy,cookie_policy,terms_policy,shipping_policy,returns_policy FROM shop_settings WHERE id=1')
    ]);
    const row = settings.rows[0] || {};
    return {
      products: products.rows.map((row) => {
        const product = publicProduct(row);
        return {
          id: product.id, sku: product.sku, slug: product.slug, category: product.category,
          name: product.name, summary: product.summary, description: product.description,
          highlights: product.highlights,
          specifications: product.specifications.map(({ label, value }) => ({ label, value })),
          faqs: product.faqs.map(({ question, answer }) => ({ question, answer }))
        };
      }),
      storefront: row.storefront_content || {},
      policies: {
        privacy_policy: row.privacy_policy || '', cookie_policy: row.cookie_policy || '',
        terms_policy: row.terms_policy || '', shipping_policy: row.shipping_policy || '',
        returns_policy: row.returns_policy || ''
      }
    };
  }

  async function saveState(locale, state) {
    const key = SETTING_KEYS[locale];
    const previous = await store.readRuntimeSetting(key).catch(() => null);
    return store.saveRuntimeSetting(key, {
      config: { ...(previous?.config || {}), ...state },
      secrets: {}
    });
  }

  async function stateFor(locale, source, revision) {
    const saved = await store.readRuntimeSetting(SETTING_KEYS[locale]).catch(() => null);
    if (saved?.config?.sourceRevision !== revision) {
      return { sourceRevision: revision, status: 'stale', lastError: '', updatedAt: null, content: null };
    }
    const state = saved.config;
    const expected = entriesForLocale(source, locale).length;
    // Earlier releases could label an unchanged source revision ready with zero
    // translated fields. Reopen those records when a locale now has translatable
    // content, so they cannot make an untranslated language look complete.
    if (expected > 0 && state.status === 'ready' && Number(state.done || 0) < expected) return { ...state, status: 'stale' };
    return state;
  }

  async function statusFor(locale) {
    let source;
    try {
      source = await sourceSnapshot();
    } catch (error) {
      return { locale, sourceRevision: '', status: 'unavailable', done: 0, total: 0, lastError: error?.message || '商城内容存储不可用。', updatedAt: null, stale: true };
    }
    const revision = sha256(source);
    const state = await stateFor(locale, source, revision);
    return { locale, sourceRevision: revision, status: state.status, done: state.done || 0, total: state.total ?? entriesForLocale(source, locale).length, lastError: state.lastError || '', updatedAt: state.updatedAt || null, stale: state.status !== 'ready' };
  }

  function isCurrentJob(locale, jobId) {
    return activeJobs.get(locale) === jobId;
  }

  async function runTranslation(locale, source, revision, jobId) {
    if (!isCurrentJob(locale, jobId)) return;
    const entries = entriesForLocale(source, locale);
    const settings = await translationService.publicSettings();
    const startedAt = new Date().toISOString();
    const current = await stateFor(locale, source, revision);
    let translated = current.content && current.sourceRevision === revision
      ? structuredClone(current.content)
      : structuredClone(source);
    await saveState(locale, { sourceRevision: revision, status: 'running', lastError: '', content: translated, total: entries.length, done: 0, startedAt, updatedAt: startedAt });
    if (!isCurrentJob(locale, jobId)) return;

    // English and Arabic pages translate the Chinese admin source; the Chinese storefront uses saved English copy when available.
    const batchSize = Math.max(5, Math.min(Number(settings.batchSize) || 40, 80));
    let done = 0;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      if (!isCurrentJob(locale, jobId)) return;
      const batch = entries.slice(offset, offset + batchSize);
    const result = await translationService.generateJson(translationPrompt(batch, locale), {
        type: 'array', capability: 'translation', temperature: 0.1, maxTokens: 16000,
        system: locale === 'en'
          ? 'You are a precise Chinese-to-English localization engine for an industrial ecommerce storefront.'
          : locale === 'ar'
            ? 'You are a precise Chinese-and-English-to-Arabic localization engine for an industrial ecommerce storefront.'
            : 'You are a precise English-to-Simplified-Chinese localization engine for an industrial ecommerce storefront.'
      });
      if (!isCurrentJob(locale, jobId)) return;
      if (!Array.isArray(result) || result.length !== batch.length) throw new Error(`翻译上游返回 ${Array.isArray(result) ? result.length : 0} 项，预期 ${batch.length} 项。`);
      const byId = new Map(result.map((item) => [String(item?.id || ''), String(item?.text || '').trim()]));
      for (const entry of batch) {
        const value = byId.get(entry.id);
        if (!value) throw new Error(`翻译结果缺少字段 ${entry.id}。`);
        setAtPath(translated, entry.id, value);
      }
      done += batch.length;
      await saveState(locale, { sourceRevision: revision, status: 'running', lastError: '', content: translated, total: entries.length, done, startedAt, updatedAt: new Date().toISOString() });
    }
    if (!isCurrentJob(locale, jobId)) return;
    await saveState(locale, { sourceRevision: revision, status: 'ready', lastError: '', content: translated, total: entries.length, done: entries.length, startedAt, updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
  }

  async function schedule(locale = 'en', force = false) {
    if (!SUPPORTED_LOCALES.includes(locale)) throw new Error('商城仅支持 en、zh-CN 和 ar。');
    const source = await sourceSnapshot();
    const revision = sha256(source);
    const state = await stateFor(locale, source, revision);
    const entries = entriesForLocale(source, locale);
    if (!force && state.status === 'ready') return state;
    if (!force && ['pending', 'running'].includes(state.status) && activeRevisions.get(locale) === revision) return state;
    if (!entries.length) {
      const timestamp = new Date().toISOString();
      await saveState(locale, { sourceRevision: revision, status: 'ready', content: source, lastError: '', total: 0, done: 0, updatedAt: timestamp, finishedAt: timestamp });
      return stateFor(locale, source, revision);
    }

    const jobId = ++jobSequence;
    activeJobs.set(locale, jobId);
    activeRevisions.set(locale, revision);
    const started = new Date().toISOString();
    await saveState(locale, { sourceRevision: revision, status: 'pending', content: state.content || null, lastError: '', total: entries.length, done: 0, updatedAt: started, finishedAt: null });
    const task = running.then(() => runTranslation(locale, source, revision, jobId));
    running = task.catch(async (error) => {
      if (!isCurrentJob(locale, jobId)) return;
      const unconfigured = error?.code === 'AI_UNCONFIGURED' || error?.code === 'TRANSLATION_UNCONFIGURED';
      logger.warn(`[商城翻译/${locale}] ${unconfigured ? '未配置' : '失败'}：${error?.message || error}`);
      // Never let a failed state write reject the shared queue: a rejected
      // `running` promise would permanently wedge every later translation.
      await saveState(locale, { sourceRevision: revision, status: unconfigured ? 'unconfigured' : 'failed', lastError: error?.message || '翻译失败。', content: null, updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString() })
        .catch((stateError) => logger.error(`[商城翻译/${locale}] 无法保存失败状态：${stateError?.message || stateError}`));
    }).catch((error) => logger.error(`[商城翻译/${locale}] 队列异常：${error?.message || error}`));
    return stateFor(locale, source, revision);
  }

  async function publicContent(requestedLocale = 'en') {
    const locale = normalizeLocale(requestedLocale);
    if (!locale) throw Object.assign(new Error('商城仅支持 en、zh-CN 和 ar。'), { status: 400 });
    const source = await sourceSnapshot();
    const revision = sha256(source);
    const entries = entriesForLocale(source, locale);
    let state = await stateFor(locale, source, revision);
    if (!entries.length) {
      if (state.status !== 'ready' || !state.content) state = await schedule(locale, false);
      return { content: state.content || source, meta: { locale, status: 'ready', sourceRevision: revision, translationRevision: revision, updatedAt: state.updatedAt || null } };
    }
    if (state.status !== 'ready') {
      if (state.status === 'stale' || activeRevisions.get(locale) !== revision && ['pending', 'running'].includes(state.status)) {
        state = await schedule(locale, false);
      }
      const latest = await stateFor(locale, source, revision);
      if (latest.status === 'ready' && latest.content) {
        return { content: latest.content, meta: { locale, status: 'ready', sourceRevision: revision, translationRevision: revision, updatedAt: latest.updatedAt } };
      }
      return { content: null, meta: { locale, status: latest.status, sourceRevision: revision, translationRevision: latest.sourceRevision, done: latest.done || 0, total: latest.total || entries.length } };
    }
    return { content: state.content, meta: { locale, status: 'ready', sourceRevision: revision, translationRevision: revision, updatedAt: state.updatedAt } };
  }

  return {
    status: async (requestedLocale = 'en') => {
      const locale = normalizeLocale(requestedLocale);
      if (!locale) throw Object.assign(new Error('商城仅支持 en、zh-CN 和 ar。'), { status: 400 });
      return statusFor(locale);
    },
    statusAll: async () => Object.fromEntries(await Promise.all(SUPPORTED_LOCALES.map(async (locale) => [locale, await statusFor(locale)]))),
    publicContent,
    retranslate: (locale = 'en') => schedule(locale, true),
    scheduleIfStale: async (locale = null) => {
      const locales = locale ? [locale] : SUPPORTED_LOCALES;
      return Object.fromEntries(await Promise.all(locales.map(async (target) => [target, await schedule(target, false)])));
    }
  };
}
