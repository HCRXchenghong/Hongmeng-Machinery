/**
 * language-pack-router.mjs —— 「语言包」与「翻译方式」的后台开关。
 *
 * 背景：官网界面词条原本只有构建期的内置词典（中/阿），要换成更专业的译法只能改代码。
 * 这里把「语言包」做成运行时可编辑、构建时注入的产物：
 *
 *   1. 语言包按语种保存（zh-CN / ar），条目形如 { "Add to cart": "加入购物车" }；
 *   2. 每个语种有一个翻译方式：pack（语言包优先）或 ai（交给 AI / 内置词典兜底）；
 *   3. 管理端保存后触发重建，构建脚本通过公开只读端点取回语言包并注入产物；
 *   4. 缺词条可以用 AI 批量补齐（复用后台已配置的网站翻译上游）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SETTING_KEY = 'language-pack';
const MAX_ENTRIES = 20000;
const MAX_VALUE_LENGTH = 4000;
const LOCALES = ['zh-CN', 'ar'];

const DEFAULT_STATE = () => ({ modes: {}, packs: {} });
const BASE64 = /^[A-Za-z0-9+/=]+$/;

/** 读取内置词典（仓库里就有，部署镜像里也会带上），用于「一键生成语言包」。 */
export function readBuiltinDictionary(rootDir, locale) {
  const file = path.join(rootDir, 'frontend', 'src', 'i18n', 'dictionaries', `${locale}.json`);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(text);
  const entries = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && key.trim()) entries[key] = value;
  }
  return entries;
}

function normalizeEntries(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('语言包必须是 { "原文": "译文" } 形式的对象。'), { status: 400 });
  }
  const entries = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    if (typeof rawValue !== 'string') {
      throw Object.assign(new Error(`词条「${key}」的译文必须是字符串。`), { status: 400 });
    }
    const value = rawValue.trim();
    if (!value) continue;
    if (value.length > MAX_VALUE_LENGTH) {
      throw Object.assign(new Error(`词条「${key}」的译文过长（上限 ${MAX_VALUE_LENGTH} 字符）。`), { status: 400 });
    }
    entries[key] = value;
    count += 1;
    if (count > MAX_ENTRIES) {
      throw Object.assign(new Error(`语言包条目过多（上限 ${MAX_ENTRIES} 条）。`), { status: 400 });
    }
  }
  return entries;
}

export function createLanguagePackRouter({ bodyJson, json, verifySession, platformStore, auditEvent, requestRebuild, translationService, rootDir, logger = console }) {
  async function readState() {
    const stored = await platformStore.readRuntimeSetting(SETTING_KEY).catch(() => null);
    const config = stored?.config && typeof stored.config === 'object' ? stored.config : {};
    return {
      modes: { ...DEFAULT_STATE().modes, ...(config.modes || {}) },
      packs: { ...(config.packs || {}) }
    };
  }

  async function writeState(state) {
    await platformStore.saveRuntimeSetting(SETTING_KEY, { config: state, secrets: {} });
  }

  function summary(state) {
    return {
      locales: LOCALES.map((locale) => {
        const pack = state.packs[locale] || {};
        const entries = pack.entries || {};
        return {
          locale,
          mode: state.modes[locale] === 'ai' ? 'ai' : 'pack',
          count: Object.keys(entries).length,
          source: pack.source || 'manual',
          updatedAt: pack.updatedAt || '',
          aiFilled: Number(pack.aiFilled || 0)
        };
      })
    };
  }

  async function handle(req, res, pathname) {
    const isAdmin = pathname.startsWith('/site-admin-api/language-packs');
    const isPublic = pathname === '/site-admin-api/public-language-pack';
    if (!isAdmin && !isPublic) return false;

    // 公开只读：构建期注入用，不带任何密钥/管理信息。
    if (isPublic) {
      const locale = new URL(req.url, 'http://localhost').searchParams.get('locale') || '';
      if (req.method !== 'GET') {
        json(res, 405, { error: { message: '只支持 GET。' } });
        return true;
      }
      if (!LOCALES.includes(locale)) {
        json(res, 400, { error: { message: `不支持的语种：${locale}` } });
        return true;
      }
      const state = await readState();
      const pack = state.packs[locale] || {};
      const mode = state.modes[locale] === 'ai' ? 'ai' : 'pack';
      json(res, 200, {
        data: {
          locale,
          mode,
          // ai 模式下不注入语言包，构建产物回落到内置词典。
          entries: mode === 'pack' ? (pack.entries || {}) : {},
          updatedAt: pack.updatedAt || ''
        }
      });
      return true;
    }

    if (!verifySession(req)) {
      json(res, 401, { error: { message: '请先登录。' } });
      return true;
    }

    try {
      if (pathname === '/site-admin-api/language-packs' && req.method === 'GET') {
        json(res, 200, { data: summary(await readState()) });
        return true;
      }

      const modeMatch = pathname.match(/^\/site-admin-api\/language-packs\/([^/]+)\/mode$/);
      if (modeMatch && req.method === 'PATCH') {
        const locale = decodeURIComponent(modeMatch[1]);
        if (!LOCALES.includes(locale)) { json(res, 400, { error: { message: `不支持的语种：${locale}` } }); return true; }
        const body = await bodyJson(req, 4096);
        const mode = body?.mode === 'ai' ? 'ai' : body?.mode === 'pack' ? 'pack' : '';
        if (!mode) { json(res, 400, { error: { message: 'mode 只能是 pack 或 ai。' } }); return true; }
        const state = await readState();
        state.modes[locale] = mode;
        await writeState(state);
        await auditEvent?.(req, 'language-pack.mode', locale, '', { mode });
        requestRebuild?.(`language-pack-mode-${locale}`);
        json(res, 200, { data: summary(state) });
        return true;
      }

      const seedMatch = pathname.match(/^\/site-admin-api\/language-packs\/([^/]+)\/seed$/);
      if (seedMatch && req.method === 'POST') {
        const locale = decodeURIComponent(seedMatch[1]);
        if (!LOCALES.includes(locale)) { json(res, 400, { error: { message: `不支持的语种：${locale}` } }); return true; }
        const entries = readBuiltinDictionary(rootDir, locale);
        const state = await readState();
        state.packs[locale] = { entries, source: 'builtin', aiFilled: 0, updatedAt: new Date().toISOString() };
        await writeState(state);
        await auditEvent?.(req, 'language-pack.seed', locale, '', { count: Object.keys(entries).length });
        json(res, 200, { data: summary(state) });
        return true;
      }

      const fillMatch = pathname.match(/^\/site-admin-api\/language-packs\/([^/]+)\/ai-fill$/);
      if (fillMatch && req.method === 'POST') {
        const locale = decodeURIComponent(fillMatch[1]);
        if (!LOCALES.includes(locale)) { json(res, 400, { error: { message: `不支持的语种：${locale}` } }); return true; }
        if (typeof translationService?.translateKeyValues !== 'function') {
          json(res, 503, { error: { message: '翻译服务不可用。' } });
          return true;
        }
        const body = await bodyJson(req, 1024 * 1024);
        const source = normalizeEntries(body?.entries || {});
        const state = await readState();
        const existing = state.packs[locale]?.entries || {};
        const missing = Object.fromEntries(Object.entries(source).filter(([key]) => !existing[key]));
        const missingCount = Object.keys(missing).length;
        if (!missingCount) {
          json(res, 200, { data: { filled: 0, missing: 0, summary: summary(state) } });
          return true;
        }
        let translated;
        try {
          translated = await translationService.translateKeyValues(locale, missing);
        } catch (error) {
          const status = error?.code === 'AI_UNCONFIGURED' || error?.code === 'TRANSLATION_UNCONFIGURED' ? 409 : 502;
          json(res, status, { error: { message: error?.message || 'AI 翻译失败。' } });
          return true;
        }
        const merged = { ...existing };
        let filled = 0;
        for (const [key, value] of Object.entries(translated)) {
          if (typeof value === 'string' && value.trim() && !existing[key]) { merged[key] = value.trim(); filled += 1; }
        }
        state.packs[locale] = {
          entries: merged,
          source: state.packs[locale]?.source || 'manual',
          aiFilled: Number(state.packs[locale]?.aiFilled || 0) + filled,
          updatedAt: new Date().toISOString()
        };
        await writeState(state);
        await auditEvent?.(req, 'language-pack.ai-fill', locale, '', { filled, missing: missingCount });
        requestRebuild?.(`language-pack-ai-fill-${locale}`);
        json(res, 200, { data: { filled, missing: missingCount, summary: summary(state) } });
        return true;
      }

      const packMatch = pathname.match(/^\/site-admin-api\/language-packs\/([^/]+)$/);
      // 管理端读取当前语言包原文（用于「导入 / 查看」）
      if (packMatch && req.method === 'GET') {
        const locale = decodeURIComponent(packMatch[1]);
        if (!LOCALES.includes(locale)) { json(res, 400, { error: { message: `不支持的语种：${locale}` } }); return true; }
        const state = await readState();
        const pack = state.packs[locale] || {};
        json(res, 200, { data: { locale, mode: state.modes[locale] === 'ai' ? 'ai' : 'pack', entries: pack.entries || {}, updatedAt: pack.updatedAt || '' } });
        return true;
      }
      if (packMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
        const locale = decodeURIComponent(packMatch[1]);
        if (!LOCALES.includes(locale)) { json(res, 400, { error: { message: `不支持的语种：${locale}` } }); return true; }
        const state = await readState();
        if (req.method === 'DELETE') {
          delete state.packs[locale];
          await writeState(state);
          await auditEvent?.(req, 'language-pack.clear', locale, '', {});
          requestRebuild?.(`language-pack-clear-${locale}`);
          json(res, 200, { data: summary(state) });
          return true;
        }
        const body = await bodyJson(req, 4 * 1024 * 1024);
        const raw = body?.entries ?? body?.pack ?? body?.content ?? body;
        const entries = normalizeEntries(raw);
        state.packs[locale] = {
          entries,
          source: String(body?.source || 'upload').slice(0, 20),
          aiFilled: Number(state.packs[locale]?.aiFilled || 0),
          updatedAt: new Date().toISOString()
        };
        await writeState(state);
        await auditEvent?.(req, 'language-pack.upload', locale, '', { count: Object.keys(entries).length });
        requestRebuild?.(`language-pack-upload-${locale}`);
        json(res, 200, { data: summary(state) });
        return true;
      }

      json(res, 404, { error: { message: '未知的语言包接口。' } });
      return true;
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) logger.error?.('[language-pack]', error?.message || error);
      json(res, status, { error: { message: error?.message || '语言包操作失败。' } });
      return true;
    }
  }

  return { handle };
}

export { SETTING_KEY as LANGUAGE_PACK_SETTING_KEY, LOCALES as LANGUAGE_PACK_LOCALES, normalizeEntries };
