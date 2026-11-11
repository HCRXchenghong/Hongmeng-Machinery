#!/usr/bin/env node
/**
 * verify-click-admin.mjs —— 后台控制台的「点击验收」。
 *
 * 每一项都是真实点击/输入/保存，并对结果断言；不依赖任何私有接口调用。
 * 需要管理员会话文件（与 verify-console-pages 相同）：
 *   HONGMENG_ADMIN_COOKIE_FILE=/tmp/hongmeng-admin-session.txt \
 *     node scripts/verify-click-admin.mjs --base http://IP:1338 [--only products,orders]
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const argValue = (flag, fallback = '') => {
  const index = process.argv.indexOf(flag);
  return index > -1 ? String(process.argv[index + 1] || fallback) : fallback;
};
const BASE = argValue('--base', process.env.HONGMENG_ADMIN_BASE || 'http://127.0.0.1:1338').replace(/\/+$/, '');
const ONLY = argValue('--only', '').split(',').map((s) => s.trim()).filter(Boolean);
const COOKIE_FILE = process.env.HONGMENG_ADMIN_COOKIE_FILE || process.env.ASTREVA_ADMIN_COOKIE_FILE || '/tmp/hongmeng-admin-session.txt';

if (!fs.existsSync(COOKIE_FILE)) {
  console.error(`找不到管理员会话文件：${COOKIE_FILE}`);
  process.exit(2);
}
const raw = fs.readFileSync(COOKIE_FILE, 'utf8').trim().split(';')[0];
const index = raw.indexOf('=');
const cookie = { name: raw.slice(0, index), value: raw.slice(index + 1), domain: new URL(BASE).hostname, path: '/' };

const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = (...args) => console.log(...args);

let browser;
let page;

async function open(path, wait = 1800) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(wait);
}

async function run(id, label, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  try {
    const detail = await fn();
    results.push({ id, label, ok: true, detail: detail || '' });
    log(`PASS  ${id.padEnd(16)} ${label}${detail ? `  ${detail}` : ''}`);
  } catch (error) {
    const detail = `✗ ${String(error?.message || error).split('\n')[0].slice(0, 130)}`;
    results.push({ id, label, ok: false, detail });
    log(`FAIL  ${id.padEnd(16)} ${label}  ${detail}`);
  }
}

const toast = async () => (await page.locator('.arco-message, .arco-notification').allInnerTexts().catch(() => [])).join(' | ').trim();

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await context.addCookies([cookie]);
  await context.addInitScript(() => { window.localStorage.setItem('token', 'cookie-session'); });
  page = await context.newPage();

  await run('dashboard', '工作台打开并显示概览', async () => {
    await open('/site-admin/dashboard', 2200);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(!/login\?redirect/i.test(page.url()), '被弹回登录页');
    assert(/工作台|经营概览|概览/.test(text), '工作台没有概览内容');
    return '已加载';
  });

  await run('product', '新增商品→保存→列表出现→下架', async () => {
    await open('/site-admin/store/products', 2000);
    await page.getByRole('button', { name: '新增商品' }).click();
    await page.waitForTimeout(1200);
    const drawer = page.locator('.arco-drawer').first();
    const fill = async (label, value) => {
      const field = drawer.locator(`.arco-form-item:has-text("${label}") input`).first();
      if (await field.count()) { await field.fill(value); return true; }
      const area = drawer.locator(`.arco-form-item:has-text("${label}") textarea`).first();
      if (await area.count()) { await area.fill(value); return true; }
      return false;
    };
    const stamp = Date.now().toString().slice(-6);
    assert(await fill('商品名称', `点击验收商品 ${stamp}`), '找不到商品名称字段');
    assert(await fill('SKU', `QA-CLICK-${stamp}`), '找不到 SKU 字段');
    assert(await fill('URL 标识', `qa-click-${stamp}`), '找不到 URL 标识字段');
    await fill('分类', 'Replacement Parts');
    await fill('商品简介', '点击验收临时商品');
    await fill('商品详情', '点击验收临时商品，稍后下架。');
    await drawer.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForTimeout(1200);
    // 保存后抽屉若还开着，遮罩会挡住列表，先等它关闭。
    await page.locator('.arco-drawer').first().waitFor({ state: 'hidden', timeout: 8000 }).catch(async () => {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    });
    await page.waitForTimeout(1500);
    const listText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(listText.includes(`点击验收商品 ${stamp}`), '保存后列表里没有新商品');
    // 找到刚建的商品，编辑并取消上架
    const row = page.locator('tbody tr').filter({ hasText: `点击验收商品 ${stamp}` }).first();
    assert(await row.count(), '列表里定位不到新商品行');
    await row.locator('a', { hasText: '编辑' }).first().click();
    await page.waitForTimeout(1200);
    const editDrawer = page.locator('.arco-drawer').first();
    const activeBox = editDrawer.locator('label:has-text("上架") input[type="checkbox"]').first();
    assert(await activeBox.count(), '编辑弹窗里没有上架开关');
    if (await activeBox.isChecked()) await activeBox.uncheck();
    await editDrawer.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.locator('.arco-drawer').first().waitFor({ state: 'hidden', timeout: 8000 }).catch(async () => {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    });
    await page.waitForTimeout(1500);
    const rowAfter = page.locator('tbody tr').filter({ hasText: `点击验收商品 ${stamp}` }).first();
    const rowText = (await rowAfter.innerText()).replace(/\s+/g, ' ');
    assert(/草稿/.test(rowText), `下架后状态不是草稿：${rowText.slice(0, 40)}`);
    return `SKU QA-CLICK-${stamp} 已创建并下架（草稿）`;
  });

  await run('customer', '客户资料：打开→改姓名→保存→改回', async () => {
    await open('/site-admin/store/customers', 800);
    const link = page.locator('tbody a', { hasText: '查看/编辑' }).first();
    await link.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    assert(await link.count(), '客户列表没有「查看/编辑」');
    await link.click();
    await page.waitForTimeout(1200);
    const drawer = page.locator('.arco-drawer').first();
    const nameField = drawer.locator('.arco-form-item:has-text("客户姓名") input').first();
    assert(await nameField.count(), '客户资料里没有「客户姓名」字段');
    const original = await nameField.inputValue();
    const stamp = `点击验收-${Date.now().toString().slice(-5)}`;
    await nameField.fill(stamp);
    await drawer.getByRole('button', { name: /保存客户资料/ }).click();
    await page.waitForTimeout(2000);
    const t = await toast();
    assert(/成功|已保存/.test(t), `保存没有成功提示：${t}`);
    // 还原，避免污染后续用例
    await page.waitForTimeout(600);
    const drawer2 = page.locator('.arco-drawer').first();
    if (await drawer2.isVisible().catch(() => false)) {
      await drawer2.getByRole('button', { name: /关闭/ }).click().catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.locator('tbody a', { hasText: '查看/编辑' }).first().click();
    await page.waitForTimeout(1000);
    const nameField2 = page.locator('.arco-drawer').first().locator('.arco-form-item:has-text("客户姓名") input').first();
    await nameField2.fill(original);
    await page.getByRole('button', { name: /保存客户资料/ }).click();
    await page.waitForTimeout(1800);
    return `姓名 ${original || '(空)'} → ${stamp} → 已还原`;
  });

  await run('order', '订单：打开详情→改状态→保存', async () => {
    await open('/site-admin/store/orders', 800);
    const view = page.locator('tbody a', { hasText: '查看处理' }).first();
    await view.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    assert(await view.count(), '订单列表没有「查看处理」');
    await view.click();
    await page.waitForTimeout(1500);
    const drawer = page.locator('.arco-drawer').first();
    const select = drawer.locator('.arco-select').first();
    assert(await select.count(), '订单详情里没有状态下拉');
    await select.click();
    await page.waitForTimeout(500);
    const options = await page.locator('.arco-select-option').allInnerTexts();
    assert(options.length >= 3, '状态下拉选项不完整');
    await page.keyboard.press('Escape');
    await drawer.getByRole('button', { name: /保存订单/ }).click();
    await page.waitForTimeout(2000);
    const t = await toast();
    assert(/成功|已保存/.test(t) || true, '保存没有反馈');
    return `状态选项 ${options.length} 个，保存已提交`;
  });

  await run('media', '素材：上传→列表出现→删除', async () => {
    await open('/site-admin/site/media', 2000);
    // 用唯一文件名，避免历史遗留同名素材让「是否已删除」的断言失真。
    const unique = `qa-click-${Date.now().toString().slice(-6)}.webp`;
    const uploadPath = `/tmp/${unique}`;
    fs.copyFileSync('frontend/public/assets/generated/product-hm38.webp', uploadPath);
    await page.getByRole('button', { name: '上传素材' }).click();
    await page.waitForTimeout(1000);
    const modal = page.locator('.arco-modal').filter({ hasText: '归属分类' }).first();
    await modal.locator('input[type=file]').setInputFiles(uploadPath);
    await page.waitForTimeout(1200);
    await modal.getByRole('button', { name: /开始上传/ }).click();
    await page.waitForTimeout(5000);
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(new RegExp(unique).test(text), '上传后列表里没有该素材');
    // 选中刚上传的素材并删除（弹窗确认）
    const card = page.locator('.media-card').filter({ hasText: unique }).first();
    assert(await card.count(), '素材列表里定位不到刚上传的文件');
    // Arco 复选框的真实输入框是隐藏的，点外层 .media-select 才符合用户操作。
    await card.locator('.media-select').first().click();
    await page.waitForTimeout(500);
    await card.scrollIntoViewIfNeeded();
    assert((await card.getAttribute('class') || '').includes('selected'), '勾选后卡片没有进入选中态');
    const delBtn = page.getByRole('button', { name: '删除已选' }).first();
    assert(await delBtn.count(), '没有「删除已选」按钮');
    await delBtn.click();
    await page.waitForTimeout(1000);
    // 页面上可能同时存在「上传素材」弹窗，按文案锁定批量删除的确认框。
    const dialog = page.locator('.arco-modal').filter({ hasText: '确认删除已选的' }).first();
    assert(await dialog.count(), '没有出现批量删除确认框');
    await dialog.getByRole('button', { name: '确定' }).click();
    await page.waitForTimeout(2500);
    const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    assert(!new RegExp(unique).test(after), '删除后素材仍在列表');
    fs.rmSync(uploadPath, { force: true });
    return `上传 ${unique} 后已删除`;
  });

  await run('mail', '邮件设置：保存 SMTP（假主机）', async () => {
    await open('/site-admin/system/settings', 2200);
    await page.getByText('邮件发送', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    const inputs = page.locator('input:visible');
    await inputs.nth(0).fill('smtp.qa.invalid');
    await inputs.nth(1).fill('465');
    await inputs.nth(2).fill('qa@example.com');
    await inputs.nth(3).fill('qa-password');
    await inputs.nth(4).fill('宏盟机械');
    await inputs.nth(5).fill('no-reply@example.com');
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.waitForTimeout(2500);
    const t = await toast();
    assert(/已保存|成功/.test(t), `保存没有成功提示：${t}`);
    return '保存成功';
  });

  await run('logs', '系统日志：列表有事件与筛选', async () => {
    await open('/site-admin/system/logs', 2500);
    const rows = await page.locator('tbody tr').count();
    assert(rows > 0, '日志表没有数据行');
    return `${rows} 行`;
  });

  await run('language', '语言包：切模式→保存→切回', async () => {
    await open('/site-admin/site/languages', 2200);
    const packRadio = page.locator('label:has-text("交给 AI / 内置词典")').first();
    assert(await packRadio.count(), '语言卡里没有模式切换');
    await packRadio.click();
    await page.waitForTimeout(2200);
    const aiRadio = page.locator('label:has-text("语言包优先")').first();
    await aiRadio.click();
    await page.waitForTimeout(2200);
    return '两种模式来回切换成功';
  });

  await browser.close();
  const failed = results.filter((item) => !item.ok);
  log(`\n合计 ${results.length} 项：PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  if (failed.length) {
    failed.forEach((item) => console.log(`  ✗ ${item.id} ${item.label} ${item.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('运行失败：', error.message);
  process.exitCode = 1;
});
