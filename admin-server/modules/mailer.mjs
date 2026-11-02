import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

/**
 * 极简 SMTP 发信：只做我们真正需要的那几步（EHLO → 可选 STARTTLS → AUTH → MAIL/RCPT/DATA → QUIT）。
 * 不引第三方库，代价是不支持 OAuth2 / 批量投递，对我们「发验证码 + 测试信」够用。
 * 设置存在运行时配置 `mail-smtp`（密码走 platform-store 的加密列），环境变量可覆盖，便于容器部署。
 */

const SETTING_KEY = 'mail-smtp';
const CONNECT_TIMEOUT_MS = 15_000;
const REPLY_TIMEOUT_MS = 20_000;

function envConfig() {
  return {
    host: String(process.env.ADMIN_SMTP_HOST || '').trim(),
    port: Number(process.env.ADMIN_SMTP_PORT || 587),
    secure: String(process.env.ADMIN_SMTP_SECURE || '') === 'true',
    user: String(process.env.ADMIN_SMTP_USER || '').trim(),
    password: String(process.env.ADMIN_SMTP_PASS || ''),
    fromEmail: String(process.env.ADMIN_SMTP_FROM || '').trim(),
    fromName: String(process.env.ADMIN_SMTP_FROM_NAME || '').trim()
  };
}

export function maskPassword(password) {
  const value = String(password || '');
  if (!value) return '';
  return `${'•'.repeat(Math.min(value.length, 8))}${value.length > 8 ? `（${value.length} 位）` : ''}`;
}

function base64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

/** 一行一行的 SMTP 应答读出来，带超时；`expect` 允许 2xx/3xx 之类的接受范围。 */
function createSession(socket) {
  let buffer = '';
  let pending = null;
  let collected = [];
  const queue = [];

  function flush() {
    while (pending && queue.length) {
      const [accept, resolve, reject] = pending;
      const line = queue.shift();
      const code = Number(line.slice(0, 3));
      collected.push(line);
      // 多行应答以 "250-" 继续，"250 " 结束。
      if (/^\d{3}-/.test(line)) continue;
      const all = collected.join('\n');
      collected = [];
      pending = null;
      if (accept.includes(code)) resolve({ code, line, all });
      else reject(new Error(`SMTP 应答异常：${line.trim()}`));
    }
  }

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\r\n');
    while (index >= 0) {
      queue.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\r\n');
    }
    flush();
  });

  function read(accept, timeout = REPLY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP 应答超时。')), timeout);
      pending = [accept, (value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }];
      flush();
    });
  }

  async function command(line, accept) {
    socket.write(`${line}\r\n`);
    return read(accept);
  }

  return { read, command };
}

async function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, timeout: CONNECT_TIMEOUT_MS })
      : net.connect({ host, port, timeout: CONNECT_TIMEOUT_MS });
    socket.once(secure ? 'secureConnect' : 'connect', () => resolve(socket));
    socket.once('timeout', () => { socket.destroy(); reject(new Error('连接 SMTP 服务器超时。')); });
    socket.once('error', reject);
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: net.isIP(host) ? undefined : host, timeout: CONNECT_TIMEOUT_MS });
    secured.once('secureConnect', () => resolve(secured));
    secured.once('error', reject);
  });
}

/** 校验并收紧用户填写的内容，顺便挡掉头注入。 */
function headerSafe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

export function buildMessage({ from, to, subject, text, html }) {
  const boundary = `hm-${crypto.randomBytes(12).toString('hex')}`;
  const date = new Date().toUTCString();
  const messageId = `<${crypto.randomUUID()}@${(from.email.split('@')[1] || 'localhost')}>`;
  const lines = [
    `From: ${from.name ? `=?UTF-8?B?${base64(from.name)}?= ` : ''}<${from.email}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${base64(headerSafe(subject))}?=`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(String(text || '')).replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(String(html || text || '')).replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}--`,
    ''
  ];
  return lines.join('\r\n');
}

export function createMailer({ platformStore, recordSystemEvent = async () => {} } = {}) {
  async function readSettings() {
    const stored = await Promise.resolve(platformStore?.readRuntimeSetting?.(SETTING_KEY)).catch(() => null);
    const env = envConfig();
    const config = stored?.config || {};
    const secrets = stored?.secrets || {};
    return {
      host: config.host || env.host,
      port: Number(config.port || env.port || 587),
      secure: typeof config.secure === 'boolean' ? config.secure : env.secure,
      user: config.user || env.user,
      password: secrets.password || env.password,
      fromEmail: config.fromEmail || env.fromEmail,
      fromName: config.fromName || env.fromName,
      updatedAt: stored?.updatedAt || ''
    };
  }

  async function smtpLogin(session, capabilities, settings) {
    if (!settings.user) return;
    if (/AUTH[^\r\n]*PLAIN/i.test(capabilities)) {
      await session.command(`AUTH PLAIN ${base64(`\0${settings.user}\0${settings.password}`)}`, [235]);
      return;
    }
    await session.command('AUTH LOGIN', [334]);
    await session.command(base64(settings.user), [334]);
    await session.command(base64(settings.password), [235]);
  }

  async function deliver({ to, subject, text, html, purpose = 'test' }) {
    const settings = await readSettings();
    if (!settings.host || !settings.fromEmail) throw new Error('还没有配置 SMTP 服务器和发件地址。');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('收件地址格式不对。');

    let socket = await connect(settings);
    let session = createSession(socket);
    try {
      await session.read([220]);
      const ehloName = settings.fromEmail.split('@')[1] || 'localhost';
      let ehlo = await session.command(`EHLO ${ehloName}`, [250]);
      // 只在服务器真的 advertise STARTTLS 时才升级，避免把明文接收端（本地测试、内网中继）拖死。
      if (!settings.secure && settings.port !== 25 && /STARTTLS/i.test(ehlo.all)) {
        await session.command('STARTTLS', [220]);
        socket = await upgradeToTls(socket, settings.host);
        session = createSession(socket);
        ehlo = await session.command(`EHLO ${ehloName}`, [250]);
      }
      await smtpLogin(session, ehlo.all, settings);
      await session.command(`MAIL FROM:<${settings.fromEmail}>`, [250]);
      await session.command(`RCPT TO:<${to}>`, [250, 251]);
      await session.command('DATA', [354]);
      const message = buildMessage({ from: { email: settings.fromEmail, name: settings.fromName }, to, subject, text, html });
      socket.write(`${message.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
      await session.read([250]);
      socket.write('QUIT\r\n');
      socket.end();
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  /** 发信并留痕；失败抛出，调用方决定怎么提示。 */
  async function send(options) {
    const recipient = headerSafe(options.to).slice(0, 200);
    const purpose = String(options.purpose || 'test').slice(0, 40);
    try {
      await deliver({ ...options, to: recipient });
    } catch (error) {
      await Promise.resolve(platformStore?.logMail?.({ recipient, purpose, status: 'failed', detail: error.message })).catch(() => {});
      await recordSystemEvent({
        category: 'mail',
        level: 'warning',
        action: 'mail.failed',
        message: `邮件发送失败：${error.message}`,
        detail: { recipient, purpose }
      }).catch(() => {});
      throw error;
    }
    await Promise.resolve(platformStore?.logMail?.({ recipient, purpose, status: 'sent', detail: '' })).catch(() => {});
    return { recipient, purpose };
  }

  return { readSettings, send, maskPassword, settingKey: SETTING_KEY };
}

/**
 * 系统设置里的邮件页用到的接口。挂载在 `/site-admin-api/system/mail-settings`。
 */
export function createMailAdminRouter({ mailer, platformStore, bodyJson, json, verifySession, auditEvent = async () => {} }) {
  const publicView = (settings) => ({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    user: settings.user,
    from_email: settings.fromEmail,
    from_name: settings.fromName,
    password_masked: maskPassword(settings.password),
    configured: Boolean(settings.host && settings.fromEmail),
    updated_at: settings.updatedAt
  });

  async function handle(req, res, pathname, url) {
    if (pathname === '/site-admin-api/system/mail-log') {
      if (!verifySession(req)) return false;
      const rows = await platformStore.listMailLog({ limit: url.searchParams.get('limit') });
      json(res, 200, { data: rows });
      return true;
    }
    if (!pathname.startsWith('/site-admin-api/system/mail-settings')) return false;
    if (!verifySession(req)) {
      json(res, 401, { error: { message: '请先登录。' } });
      return true;
    }
    if (req.method === 'GET' && pathname === '/site-admin-api/system/mail-settings') {
      json(res, 200, { data: publicView(await mailer.readSettings()) });
      return true;
    }
    if (req.method === 'PATCH' && pathname === '/site-admin-api/system/mail-settings') {
      const body = await bodyJson(req, 8192);
      const existing = await mailer.readSettings();
      const config = {
        host: String(body.host ?? existing.host ?? '').trim().slice(0, 200),
        port: Math.min(Math.max(Number(body.port ?? existing.port) || 587, 1), 65535),
        secure: Boolean(body.secure),
        user: String(body.user ?? existing.user ?? '').trim().slice(0, 200),
        fromEmail: String(body.from_email ?? existing.fromEmail ?? '').trim().slice(0, 200),
        fromName: String(body.from_name ?? existing.fromName ?? '').trim().slice(0, 120)
      };
      if (config.fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.fromEmail)) {
        json(res, 400, { error: { message: '发件地址格式不对。' } });
        return true;
      }
      const password = body.clear_password ? '' : (body.password ? String(body.password).slice(0, 200) : existing.password);
      await platformStore.saveRuntimeSetting(mailer.settingKey, { config, secrets: { password } });
      await auditEvent({ action: 'system.mail_settings_saved', detail: { host: config.host, fromEmail: config.fromEmail } }).catch(() => {});
      json(res, 200, { data: publicView(await mailer.readSettings()) });
      return true;
    }
    if (req.method === 'POST' && pathname === '/site-admin-api/system/mail-settings/test') {
      const body = await bodyJson(req, 4096);
      const to = String(body.to || '').trim() || (await mailer.readSettings()).fromEmail;
      try {
        await mailer.send({
          to,
          subject: '鸿蒙机械：SMTP 测试邮件',
          text: `这是一封测试邮件，收到说明后台邮件配置可用。\n时间：${new Date().toISOString()}`,
          purpose: 'test'
        });
        json(res, 200, { data: { message: `测试邮件已发送到 ${to}，请查收。` } });
      } catch (error) {
        json(res, 400, { error: { message: `发送失败：${error.message}` } });
      }
      return true;
    }
    return false;
  }

  return { handle };
}
