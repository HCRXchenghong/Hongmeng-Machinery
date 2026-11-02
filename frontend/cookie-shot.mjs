import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const out = 'cookie-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe });

async function shot(name, width, height, actions) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:4331/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.hm-cookie-dialog', { timeout: 20000 });
  if (actions) await actions(page);
  await page.waitForTimeout(350);
  const box = await page.locator('.hm-cookie-dialog').boundingBox();
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'box=', JSON.stringify(box), 'hOverflow=', overflowX, 'errors=', errors.length ? errors.slice(0, 3) : 0);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await ctx.close();
}

await shot('desktop-1440', 1440, 900);
await shot('desktop-1920-customized', 1920, 1000, async (page) => {
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.hm-cookie-actions button')];
    buttons[1].click();
  });
});
await shot('desktop-1024', 1024, 800);
await shot('mobile-390', 390, 844);
await shot('mobile-390-customized', 390, 844, async (page) => {
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.hm-cookie-actions button')];
    buttons[1].click();
  });
});
await browser.close();
