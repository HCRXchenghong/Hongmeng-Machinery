#!/usr/bin/env node
/**
 * check-i18n-parity.mjs —— 多语言字典键位对齐检查。
 *
 * 背景：词条以中文为源，阿语字典缺词条时前台会**原样显示英文**（translate() 的兜底）。
 * 历史欠账用 BASELINE 冻结，避免「缺口变大」无声无息；补齐后把基线下调即可。
 *
 * 用法：node scripts/check-i18n-parity.mjs [--strict]
 *   --strict  要求零缺口（译完后可切换，给 CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_DIR = path.join(ROOT, 'frontend', 'src', 'i18n', 'dictionaries');
const SOURCE = 'zh-CN.json';
/** 当前已知缺口（阿拉伯语待译条目数）。只允许变小。 */
const BASELINE = 104;

const strict = process.argv.includes('--strict');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DICT_DIR, name), 'utf8'));
const source = read(SOURCE);
const targets = fs
  .readdirSync(DICT_DIR)
  .filter((name) => name.endsWith('.json') && name !== SOURCE)
  .sort();

if (!targets.length) {
  console.error('没有找到需要比对的字典文件。');
  process.exit(2);
}

let failed = false;
for (const name of targets) {
  const dict = read(name);
  const missing = Object.keys(source).filter((key) => !(key in dict));
  const limit = strict ? 0 : BASELINE;
  const status = missing.length > limit ? 'FAIL' : 'PASS';
  if (status === 'FAIL') failed = true;
  console.log(`${status}  ${name}：缺 ${missing.length} 条（上限 ${limit}）`);
  if (missing.length) {
    console.log(`      样例：${missing.slice(0, 5).map((key) => JSON.stringify(key.slice(0, 24))).join(', ')}`);
    console.log('      前台缺词条时会直接显示英文；补齐后请下调 BASELINE。');
  }
}

process.exit(failed ? 1 : 0);
