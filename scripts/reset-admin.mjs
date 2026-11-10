import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import QRCode from 'qrcode';

// 用法：node scripts/reset-admin.mjs <新邮箱> <新密码> [--env-file PATH] [--via-compose] [--base-url URL]
// 用途：忘记后台账号密码时，重置管理员邮箱/密码并重新生成 2FA 密钥（含登录自测与二维码）。
//
// 生产机上 DATABASE_URL 里的主机名是 compose 服务名（postgres），宿主机解析不到，
// 所以脚本默认在「连不上且带 --via-compose」时改走容器内的 psql；不放心就直接加该参数。
const args = process.argv.slice(2);
const options = { envFile: '', viaCompose: false, baseUrl: 'http://127.0.0.1:1338' };
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--env-file') { options.envFile = args[i + 1] || ''; i += 1; }
  else if (arg === '--via-compose') options.viaCompose = true;
  else if (arg === '--base-url') { options.baseUrl = args[i + 1] || options.baseUrl; i += 1; }
  else positional.push(arg);
}
const [NEW_EMAIL, NEW_PASSWORD] = positional;
if (!NEW_EMAIL || !NEW_PASSWORD) {
  console.error('用法：node scripts/reset-admin.mjs <新邮箱> <新密码> [--env-file PATH] [--via-compose] [--base-url URL]');
  process.exit(1);
}
const rootDir = process.cwd();
// 生产环境文件优先，其次才是本地的 .env。
const candidateEnvFiles = [
  options.envFile,
  process.env.HONGMENG_ENV_FILE || '',
  path.join(rootDir, 'deployments', 'ubuntu', '.env.ubuntu'),
  path.join(rootDir, '.env')
].filter(Boolean);
const envFile = candidateEnvFiles.find((file) => fs.existsSync(file));
if (!envFile) throw new Error(`找不到环境文件，试过：${candidateEnvFiles.join(', ')}`);
const envText = fs.readFileSync(envFile, 'utf8');
const cfg = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const DATABASE_URL = cfg.DATABASE_URL;
// 生产环境用 DATA_ENCRYPTION_KEY，本地 .env 用 CMS_DATA_ENCRYPTION_KEY，两者都认。
const KEY = cfg.DATA_ENCRYPTION_KEY || cfg.CMS_DATA_ENCRYPTION_KEY;
if (!DATABASE_URL || !KEY) throw new Error(`环境文件 ${envFile} 缺少 DATABASE_URL 或 DATA_ENCRYPTION_KEY`);

const key = crypto.createHash('sha256').update(KEY).digest();
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += b32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += b32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(secret) {
  const clean = String(secret).toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0, value = 0; const bytes = [];
  for (const ch of clean) {
    const idx = b32.indexOf(ch);
    if (idx === -1) throw new Error('bad secret');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function generateTotp(secret, counter) {
  const k = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', k).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

const secret = base32Encode(crypto.randomBytes(20));
const passwordHash = await bcrypt.hash(NEW_PASSWORD, 12);
const encryptedSecret = encrypt(secret);

const sqlEscape = (value) => String(value).replace(/'/g, "''");
const updateSql = "UPDATE site_admin_users SET email = '" + sqlEscape(NEW_EMAIL) + "', password_hash = '" + sqlEscape(passwordHash) + "', " +
  "totp_secret = '" + sqlEscape(encryptedSecret) + "', updated_at = now() " +
  "WHERE id = (SELECT id FROM site_admin_users ORDER BY created_at ASC LIMIT 1) RETURNING id, email;";

/** 生产机上 DATABASE_URL 指向 compose 服务名，宿主机连不上时改走容器内的 psql。 */
async function updateViaCompose() {
  const { execFileSync } = await import('node:child_process');
  const composeFile = path.join(rootDir, 'deployments', 'ubuntu', 'docker-compose.ubuntu.yml');
  const out = execFileSync('docker', [
    'compose', '-f', composeFile, '--env-file', envFile,
    'exec', '-T', 'postgres', 'psql', '-U', cfg.POSTGRES_USER || 'site', '-d', cfg.POSTGRES_DB || 'customer_service',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', updateSql
  ], { encoding: 'utf8' });
  const row = out.trim().split('\n').filter(Boolean).pop() || '';
  const [id, email] = row.split('|');
  return { rows: id ? [{ id, email }] : [] };
}

let res;
if (options.viaCompose) {
  res = await updateViaCompose();
} else {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    res = await client.query(updateSql);
  } catch (error) {
    if (!/ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(error.message || '')) throw error;
    console.error('直连数据库失败（多半是容器内主机名），改用 docker compose exec psql 重试…');
    res = await updateViaCompose();
  } finally {
    await client.end().catch(() => {});
  }
}
if (!res.rows.length) throw new Error('no admin user row found');

const base = options.baseUrl;
const start = await (await fetch(base + '/site-admin-auth/login/start', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: NEW_EMAIL, password: NEW_PASSWORD })
})).json();
const code = generateTotp(secret, Math.floor(Date.now() / 30000));
const verify = await (await fetch(base + '/site-admin-auth/login/verify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ challengeId: start.challengeId, code })
})).json();

const otpauth = `otpauth://totp/${encodeURIComponent('宏盟机械管理台:' + NEW_EMAIL)}?secret=${secret}&issuer=${encodeURIComponent('宏盟机械管理台')}&algorithm=SHA1&digits=6&period=30`;
const qrPath = path.join(rootDir, '.local-logs', 'admin-2fa-reset.png');
await QRCode.toFile(qrPath, otpauth, { margin: 1, width: 320 });

console.log(JSON.stringify({
  updated: res.rows[0],
  email: NEW_EMAIL,
  password: NEW_PASSWORD,
  loginStartStatus: start.challengeId ? 'ok' : start,
  loginVerifyStatus: verify,
  secret,
  otpauth,
  qrPath
}, null, 2));
