#!/usr/bin/env node
/**
 * 首屏语言一致性检查（防回归）。
 *
 * 背景：中文/阿拉伯语页面曾经先输出英文 HTML，再由 locale-*.js 在 hydration
 * 之后改写 DOM，导致刷新时闪烁英文。本脚本在真实 Chromium 中记录首屏每一帧
 * 的可见文字，并直接检查静态 HTML，任何一帧出现英文即失败。
 *
 * 用法：
 *   node scripts/check-locale-first-paint.mjs http://127.0.0.1:4331
 */

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const base = (process.argv[2] || process.env.SITE_URL || 'http://127.0.0.1:4331').replace(/\/$/, '');
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);
const executablePath = chromeCandidates.find((path) => existsSync(path));

if (!executablePath) {
  console.error('未找到 Chromium/Chrome，可通过 CHROME_PATH 指定。');
  process.exit(2);
}

const cases = [
  { path: '/zh/', lang: 'zh-CN', label: '中文首页', chinese: true, marker: '工程机械属具', forbidden: ['Equipment built to take on tougher work.', 'Shop attachments', 'Loading products'] },
  { path: '/zh/shop/', lang: 'zh-CN', label: '中文商城', chinese: true, marker: '选购属具', forbidden: ['Shop attachments', 'Loading products'] },
  { path: '/zh/account/login/', lang: 'zh-CN', label: '中文登录', chinese: true, marker: '客户账户', forbidden: ['Sign in to Hongmeng Machinery', 'Welcome back'] },
  { path: '/zh/shop/product/mm38-mini-skid-steer-drum-mulcher/', lang: 'zh-CN', label: '中文商品详情', chinese: true, marker: '小型滑移装载机', forbidden: ['Loading product details', 'Loading products', 'Add to cart'] },
  { path: '/zh/privacy/', lang: 'zh-CN', label: '中文隐私政策', chinese: true, marker: '隐私', forbidden: ['Privacy Notice', 'Last updated: October 22, 2026'] },
  { path: '/ar/', lang: 'ar', label: '阿拉伯语首页', chinese: false, marker: 'ملحقات', forbidden: ['Equipment built to take on tougher work.', 'Shop attachments'] },
  { path: '/ar/shop/', lang: 'ar', label: '阿拉伯语商城', chinese: false, marker: 'المتجر', forbidden: ['Shop attachments', 'Loading products'] },
  { path: '/ar/privacy/', lang: 'ar', label: '阿拉伯语隐私政策', chinese: false, marker: 'الخصوصية', forbidden: ['Privacy Notice', 'This notice describes'] },
  { path: '/', lang: 'en-US', label: '英文首页', chinese: false, marker: 'Hongmeng Machinery', forbidden: [] }
];

const failures = [];

async function checkStaticHtml(testCase) {
  const response = await fetch(`${base}${testCase.path}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) {
    failures.push(`${testCase.label}: HTTP ${response.status}`);
    return;
  }
  const html = await response.text();
  for (const text of testCase.forbidden) {
    if (html.includes(text)) failures.push(`${testCase.label}: 静态 HTML 含英文 “${text}”`);
  }
  if (!html.includes(testCase.marker)) failures.push(`${testCase.label}: 静态 HTML 缺少语言标记 “${testCase.marker}”`);
}

async function sampleFirstPaint(browser, testCase) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: testCase.lang });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__hmFrames = [];
    const record = () => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      const lang = document.documentElement.lang;
      const last = window.__hmFrames.at(-1);
      if (!last || last.text !== text || last.lang !== lang) {
        window.__hmFrames.push({ t: performance.now(), text, lang });
      }
      if (performance.now() < 5000) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  const response = await page.goto(`${base}${testCase.path}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);
  const frames = await page.evaluate(() => window.__hmFrames || []);
  const lang = await page.evaluate(() => document.documentElement.lang);
  const title = await page.title();
  await page.screenshot({ path: `/tmp/hm-${testCase.path.replaceAll('/', '_') || 'root'}.png`, fullPage: false });
  await context.close();

  if (!response || response.status() >= 400) failures.push(`${testCase.label}: 页面加载失败`);
  if (lang !== testCase.lang) failures.push(`${testCase.label}: lang=${lang}，期望 ${testCase.lang}`);
  for (const frame of frames) {
    for (const text of testCase.forbidden) {
      if (frame.text.includes(text)) failures.push(`${testCase.label}: 第 ${Math.round(frame.t)}ms 帧仍出现英文 “${text}”`);
    }
  }
  const first = frames[0]?.text || '';
  // 首帧只要已经包含中文即视为目标语言；marker 用于静态 HTML 校验，
  // 登录页首帧可能只渲染导航而尚未出现“客户账户”，不能误判为英文闪屏。
  if (testCase.chinese && !/[\u4e00-\u9fff]/.test(first) && /[A-Za-z]{4,}/.test(first)) {
    failures.push(`${testCase.label}: 首帧不是目标语言：${first.slice(0, 120)}`);
  }
  console.log(`${testCase.label} ${testCase.path} lang=${lang} 首帧 ${Math.round(frames[0]?.t || 0)}ms title=${title}`);
  console.log(`  首帧文字: ${first.slice(0, 140)}`);
  console.log(`  末帧文字: ${(frames.at(-1)?.text || '').slice(0, 140)}`);
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const testCase of cases) {
    await checkStaticHtml(testCase);
    await sampleFirstPaint(browser, testCase);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('\n语言首屏检查失败：');
  for (const failure of [...new Set(failures)]) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('\n语言首屏检查通过：所有语言从第一帧起即为目标语言。');
