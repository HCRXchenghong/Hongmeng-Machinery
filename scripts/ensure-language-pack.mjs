#!/usr/bin/env node
/**
 * 把后台「语言包」写进 frontend/src/i18n/generated-pack.json（i18n 静态合并用）。
 *
 * 两条构建路径都会调用它：
 *   - scripts/build-frontend.mjs → npm run build:frontend（生产重建）
 *   - 直接 npm run build:frontend（本地改样式时）
 *
 * 取不到（后台没起/没有语言包）就写空包，等价于「全用内置词典」，绝不阻塞构建。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'frontend', 'src', 'i18n', 'generated-pack.json');
const LOCALES = ['zh-CN', 'ar'];
const apiBase = (process.env.CONTENT_API_URL || process.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');

async function fetchPack(locale) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${apiBase}/site-admin-api/public-language-pack?locale=${encodeURIComponent(locale)}`, {
      headers: { 'Cache-Control': 'no-store' },
      signal: controller.signal
    });
    if (!response.ok) return {};
    const payload = await response.json();
    const entries = payload?.data?.entries;
    return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

const result = {};
for (const locale of LOCALES) result[locale] = await fetchPack(locale);
fs.writeFileSync(FILE, JSON.stringify(result));
const counts = LOCALES.map((locale) => `${locale}=${Object.keys(result[locale]).length}`).join(' ');
console.log(`[i18n] 语言包：${counts}`);
