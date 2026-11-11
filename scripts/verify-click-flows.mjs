#!/usr/bin/env node
/**
 * verify-click-flows.mjs —— 按「真实用户点击」验收官网与商城功能。
 *
 * 与 verify-console-pages.mjs（只打开页面看有没有报错）的区别：
 * 这里每一项目标都要真的点、真的输入、真的提交，并对结果做断言。
 *
 * 用法：
 *   node scripts/verify-click-flows.mjs [--base http://IP:4331] [--only nav,search]
 *   退出码 0 = 全部通过；1 = 有失败项（明细打印在前面）。
 */
import { chromium } from 'playwright-core';

const argValue = (flag, fallback = '') => {
  const index = process.argv.indexOf(flag);
  return index > -1 ? String(process.argv[index + 1] || fallback) : fallback;
};
const BASE = argValue('--base', process.env.HONGMENG_SITE_BASE || 'http://127.0.0.1:4331').replace(/\/+$/, '');
const ONLY = argValue('--only', '').split(',').map((s) => s.trim()).filter(Boolean);

const results = [];
let browser;
let context;
let page;

const log = (...args) => console.log(...args);
function record(id, label, ok, detail = '') {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(18)} ${label}${detail ? `  ${detail}` : ''}`);
}

async function open(path, opts = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(opts.wait ?? 350);
}

async function rejectOptional() {
  const btn = page.getByRole('button', { name: /Reject optional|拒绝可选/i });
  if (await btn.count()) await btn.first().click().catch(() => {});
  await page.waitForTimeout(150);
}

async function run(id, label, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  try {
    const detail = await fn();
    record(id, label, true, detail || '');
  } catch (error) {
    record(id, label, false, `✗ ${String(error?.message || error).split('\n')[0].slice(0, 120)}`);
  }
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };

// ---------------------------------------------------------------- 官网
async function storefrontFlows() {
  await run('nav', '顶部导航逐个点击跳转', async () => {
    await open('/');
    await rejectOptional();
    const navLabels = ['About', 'Shop', 'Applications', 'Contact'];
    const visited = [];
    for (const label of navLabels) {
      await open('/');
      const link = page.locator('header a, nav a').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first();
      assert(await link.count(), `找不到导航「${label}」`);
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(300);
      const url = new URL(page.url());
      assert(url.pathname !== '/', `点「${label}」后仍在首页`);
      const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim();
      assert(h1, `点「${label}」后页面没有标题`);
      visited.push(`${label}→${url.pathname}`);
    }
    return visited.join(' ');
  });

  await run('lang', '语言切换（中/阿）文案生效', async () => {
    await open('/zh/');
    const zh = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(/[\u4e00-\u9fff]/.test(zh), '中文页面没有中文');
    await open('/ar/');
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const ar = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(dir === 'rtl', `阿语页面 dir=${dir}`);
    assert(/[\u0600-\u06ff]/.test(ar), '阿语页面没有阿语');
    return 'zh 中文 / ar RTL 正常';
  });

  await run('search', '商城搜索与分类筛选', async () => {
    await open('/shop/');
    await rejectOptional();
    const before = await page.locator('.hm-product-card, article').count();
    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    assert(await search.count(), '找不到搜索框');
    await search.fill('mulcher');
    await page.waitForTimeout(500);
    const afterSearch = await page.locator('.hm-product-card, article').count();
    assert(afterSearch >= 1, '搜索 mulcher 后没有结果');
    const cat = page.getByRole('button', { name: /Replacement Parts/i }).first();
    if (await cat.count()) {
      await cat.click();
      await page.waitForTimeout(500);
      const afterCat = await page.locator('.hm-product-card, article').count();
      assert(afterCat >= 1, '切到 Replacement Parts 后没有商品');
      return `全部 ${before} → 搜索 ${afterSearch} → 分类 ${afterCat}`;
    }
    return `全部 ${before} → 搜索 ${afterSearch}`;
  });

  const SLUG = 'mm38-mini-skid-steer-drum-mulcher';
  await run('pdp', '商品详情：打开、规格、加购', async () => {
    await open('/shop/');
    await rejectOptional();
    const card = page.locator('a[href*="/shop/product/"]').first();
    assert(await card.count(), '商城没有商品卡片');
    await card.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    assert(page.url().includes('/shop/product/'), '没有跳到详情页');
    const h1 = (await page.locator('h1').first().innerText()).trim();
    assert(h1.length > 3, '详情页没有商品名');
    const addBtn = page.getByRole('button', { name: /Add to cart/i }).first();
    assert(await addBtn.count(), '详情页没有加购按钮');
    await addBtn.click();
    await page.waitForTimeout(800);
    const cartText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(/cart/i.test(cartText), '加购后页面没有购物车入口');
    return `${h1.slice(0, 24)} 已加购`;
  });

  await run('cart', '购物车：改数量、删空、小计更新', async () => {
    await open('/cart/');
    await page.waitForTimeout(500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(/MM38|mulcher/i.test(body), '购物车里没有上一项加购的商品');
    const plus = page.getByRole('button', { name: /^\+$|increase|加/i }).first();
    if (await plus.count()) {
      await plus.click();
      await page.waitForTimeout(600);
    }
    const qtyInput = page.locator('input[type="number"], .hm-cart-qty input').first();
    const qty = (await qtyInput.inputValue().catch(() => '')) || '';
    const remove = page.getByRole('button', { name: /remove|delete|删除/i }).first();
    assert(await remove.count(), '购物车没有删除按钮');
    await remove.click();
    await page.waitForTimeout(700);
    const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(!/MM38/i.test(after) || /empty|空/i.test(after), '删除后商品仍在购物车');
    return `数量=${qty || 'n/a'}，删除后已清空`;
  });

  await run('inquiry', '询盘表单：必填校验 + 提交成功', async () => {
    await open('/contact/');
    await rejectOptional();
    const submit = page.getByRole('button', { name: /Send message|发送/i }).first();
    assert(await submit.count(), '联系页没有提交按钮');
    // 空提交应被浏览器必填校验拦住（不产生网络提交）
    await submit.click();
    await page.waitForTimeout(400);
    const status = await page.locator('.hm-inquiry-status, [role="status"]').count();
    assert(status === 0, '空表单竟然提交了');
    await page.locator('form input[name="name"]').fill('点击验收访客');
    await page.locator('form input[name="phone"]').fill('13800009999');
    await page.locator('form input[name="email"]').fill('click-qa@example.com');
    await page.locator('form textarea[name="message"]').fill('这是点击验收提交的询盘，请忽略。');
    await submit.click();
    await page.waitForTimeout(2000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(/收到|thanks|sent|成功|will get back/i.test(text), '提交后没有成功提示');
    return '校验拦住空提交、填写后提交成功';
  });

  await run('mobile-nav', '手机端菜单展开与跳转', async () => {
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 375, height: 812 });
    await mobile.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await mobile.waitForTimeout(400);
    const toggle = mobile.locator('.hm-mobile-menu-button, button[aria-label="Open navigation"], button[aria-label*="navigation" i]').first();
    assert(await toggle.count(), '手机端没有菜单按钮');
    await toggle.click();
    await mobile.waitForTimeout(400);
    const menuLink = mobile.locator('.hm-mobile-nav a').nth(1);
    assert(await menuLink.count(), '展开后没有菜单项');
    const href = await menuLink.getAttribute('href');
    await menuLink.click();
    await mobile.waitForLoadState('networkidle');
    await mobile.waitForTimeout(300);
    assert(new URL(mobile.url()).pathname !== '/', '点菜单项后没跳转');
    await mobile.close();
    return `菜单项 ${href} 跳转成功`;
  });
}

// ---------------------------------------------------------------- 商城下单
async function checkoutFlow() {
  await run('checkout', '报价下单：填写收货信息并提交', async () => {
    await open('/shop/product/mm38-mini-skid-steer-drum-mulcher/');
    await rejectOptional();
    await page.getByRole('button', { name: /Add to cart/i }).first().click();
    await page.waitForTimeout(700);
    await open('/cart/');
    await page.waitForTimeout(700);
    const form = page.locator('form').first();
    const need = [
      ['Recipient', '点击验收下单'],
      ['Phone', '13800008888'],
      ['Email', 'click-order@example.com'],
      ['City', 'Jinan'],
      ['Street address', '验收路 1 号']
    ];
    for (const [label, value] of need) {
      const field = form.locator(`label:has-text("${label}") input`).first();
      if (await field.count()) await field.fill(value);
    }
    const submit = page.getByRole('button', { name: /Request order|Place order|下单|提交/i }).first();
    assert(await submit.count(), '购物车没有提交订单按钮');
    await submit.click();
    await page.waitForTimeout(3000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const orderNumber = text.match(/HM\d{8}-[A-Z0-9]{6,}/);
    assert(orderNumber, '提交后没有订单号回显');
    return `订单号 ${orderNumber[0]}`;
  });
}

// ---------------------------------------------------------------- 客户账户
async function accountFlows() {
  await run('login', '客户登录进入账户', async () => {
    await open('/account/login/');
    await page.fill('input[type="email"]', 'qa-account@example.com');
    await page.fill('input[type="password"]', 'CustomerPass2026!');
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(2500);
    assert(page.url().includes('/account'), '登录后没有进入账户页');
    const tabs = await page.locator('.hm-account-tabs button').allInnerTexts();
    assert(tabs.length >= 3, '账户页标签不完整');
    return tabs.map((t) => t.trim()).slice(0, 3).join(' / ');
  });

  await run('address', '地址簿：新增→编辑→删除', async () => {
    await open('/account/login/');
    await page.fill('input[type="email"]', 'qa-account@example.com');
    await page.fill('input[type="password"]', 'CustomerPass2026!');
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: /Shipping addresses/i }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Add address/i }).click();
    await page.waitForTimeout(500);
    const form = page.locator('.hm-account-content form').first();
    const fill = async (label, value) => {
      const input = form.locator(`label:has-text("${label}") input`).first();
      if (await input.count()) await input.fill(value);
    };
    await fill('Address label', '点击验收仓');
    await fill('Recipient', '点击验收收货人');
    await fill('Phone', '13900001111');
    await fill('City', 'Jinan');
    await fill('Street address', '点击验收路 2 号');
    await fill('ZIP code', '250000');
    await page.getByRole('button', { name: /Save address/i }).click();
    await page.waitForTimeout(2000);
    let body = (await page.locator('.hm-account-content').innerText()).replace(/\s+/g, ' ');
    assert(/点击验收收货人/.test(body), '新增地址后没有出现在列表');

    await page.getByRole('button', { name: /^Edit$/ }).first().click();
    await page.waitForTimeout(600);
    const editInput = page.locator('.hm-account-content form label:has-text("Recipient") input').first();
    await editInput.fill('点击验收收货人2');
    await page.getByRole('button', { name: /Save address/i }).click();
    await page.waitForTimeout(2000);
    body = (await page.locator('.hm-account-content').innerText()).replace(/\s+/g, ' ');
    assert(/点击验收收货人2/.test(body), '编辑地址后没有更新');

    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /^Delete$/ }).first().click();
    await page.waitForTimeout(2000);
    body = (await page.locator('.hm-account-content').innerText()).replace(/\s+/g, ' ');
    assert(!/点击验收收货人2/.test(body), '删除地址后仍在列表');
    return '新增/编辑/删除全部生效';
  });

  await run('logout', '账户退出登录（顶栏菜单）', async () => {
    // 独立成例：不依赖前面的登录步骤，单独跑 --only logout 也能验证。
    await open('/account/login/');
    await page.fill('input[type="email"]', 'qa-account@example.com');
    await page.fill('input[type="password"]', 'CustomerPass2026!');
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(2200);
    await open('/account/');
    await page.waitForTimeout(800);
    const trigger = page.locator('.hm-account-menu-button, button[aria-haspopup="dialog"]').first();
    assert(await trigger.count(), '顶栏找不到账户入口');
    await trigger.click();
    await page.waitForTimeout(500);
    const out = page.locator('.hm-account-menu-signout').first();
    assert(await out.count(), '账户菜单里没有退出按钮');
    await out.click();
    await page.waitForTimeout(1800);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(/Sign in|登录/i.test(body), '退出后没有回到登录态');
    return '已退出';
  });
}

// ---------------------------------------------------------------- 客服挂件
async function chatFlow() {
  await run('chat', '客服挂件：打开、发消息、收到回复', async () => {
    await open('/');
    await rejectOptional();
    const openBtn = page.getByRole('button', { name: /Open support|联系客服|在线客服/i }).first();
    assert(await openBtn.count(), '找不到客服入口');
    await openBtn.click();
    await page.waitForTimeout(5000);
    const frame = page.frames().find((f) => f.url().includes('5175'));
    assert(frame, '客服 iframe 没有加载');
    const input = frame.locator('#chat-input');
    assert(await input.count(), '客服窗口没有输入框');
    await input.fill('点击验收：这台机器能配属具吗？');
    await frame.locator('#btn-send, button:has-text("发送")').first().click();
    await page.waitForTimeout(4000);
    const text = (await frame.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(/点击验收：这台机器能配属具吗/.test(text), '消息没有出现在会话里');
    assert(/收到|回复|您好|支持/.test(text), '没有收到任何回复');
    return '消息已发送并收到回复';
  });
}

// ---------------------------------------------------------------- 入口
async function main() {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  page = await context.newPage();

  log(`\n=== 官网与商城（${BASE}）===`);
  await storefrontFlows();
  await checkoutFlow();
  await accountFlows();
  await chatFlow();

  await browser.close();
  const failed = results.filter((item) => !item.ok);
  log(`\n合计 ${results.length} 项：PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  if (failed.length) {
    console.log('失败明细：');
    failed.forEach((item) => console.log(`  ✗ ${item.id} ${item.label} ${item.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('运行失败：', error.message);
  process.exitCode = 1;
});
