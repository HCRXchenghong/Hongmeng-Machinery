import crypto from 'node:crypto';

/**
 * 邮箱验证码：注册与「下单后保存到账户」共用一个流程。
 * 码只存 HMAC（不存明文），10 分钟有效，同一邮箱 60 秒只能要一次、每小时最多 5 次，错 5 次作废。
 */

const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function hashCode(email, code, secret) {
  return crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

function sameHash(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createVerification({ store, mailer, json, bodyJson, applyPublicCors, resolveClient, secret, siteName = '鸿蒙机械' }) {
  const signingSecret = String(secret || 'astreva-email-code-secret');
  const issuedAt = new Map();

  async function recentCodes(email) {
    const result = await store.query(
      'SELECT id, attempts, created_at, used_at FROM email_verification_codes WHERE lower(email)=lower($1) AND created_at > now() - interval \'1 hour\' ORDER BY created_at DESC',
      [email]
    );
    return result.rows;
  }

  async function issue(email, purpose) {
    const rows = await recentCodes(email);
    const last = rows[0];
    if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return { throttled: Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(last.created_at).getTime())) / 1000) };
    }
    if (rows.length >= MAX_PER_HOUR) return { throttled: 3600 };

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    // 只保留最新一条有效码，旧的直接作废。
    await store.query('UPDATE email_verification_codes SET used_at = now() WHERE lower(email)=lower($1) AND used_at IS NULL', [email]);
    await store.query(
      'INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5)',
      [`code_${crypto.randomUUID()}`, email, purpose, hashCode(email, code, signingSecret), new Date(Date.now() + CODE_TTL_MS).toISOString()]
    );
    await mailer.send({
      to: email,
      subject: `${siteName} 验证码 ${code}`,
      text: `你的验证码是 ${code}，10 分钟内有效。不是本人操作可以忽略这封邮件。`,
      html: `<p>你的验证码是</p><p style="font-size:26px;letter-spacing:4px;font-weight:700">${code}</p><p>10 分钟内有效。不是本人操作可以忽略这封邮件。</p>`,
      purpose
    });
    return { throttled: 0, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async function verify(email, code) {
    const value = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(value)) return { ok: false, reason: '验证码应为 6 位数字。' };
    const result = await store.query(
      'SELECT * FROM email_verification_codes WHERE lower(email)=lower($1) AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [email]
    );
    const row = result.rows[0];
    if (!row) return { ok: false, reason: '请先获取验证码。' };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: '验证码已过期，请重新获取。' };
    if (Number(row.attempts) >= MAX_ATTEMPTS) return { ok: false, reason: '验证码错误次数过多，请重新获取。' };
    if (!sameHash(hashCode(email, value, signingSecret), row.code_hash)) {
      await store.query('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id=$1', [row.id]);
      return { ok: false, reason: '验证码不正确。' };
    }
    await store.query('UPDATE email_verification_codes SET used_at = now() WHERE id=$1', [row.id]);
    return { ok: true };
  }

  /** POST /site-admin-api/customer/email-code —— 公开接口，限流 + 来源白名单。 */
  async function handleIssue(req, res) {
    if (!applyPublicCors(req, res)) {
      json(res, 403, { error: { message: '该网站来源不允许申请验证码。' } });
      return true;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: { message: '该接口仅支持 POST。' } });
      return true;
    }
    const ip = resolveClient(req)?.ip || 'unknown';
    const now = Date.now();
    const bucket = (issuedAt.get(ip) || []).filter((time) => now - time < 3_600_000);
    if (bucket.length >= 20) {
      json(res, 429, { error: { message: '申请太频繁，请过一会儿再试。' } });
      return true;
    }
    bucket.push(now);
    issuedAt.set(ip, bucket);
    if (issuedAt.size > 5000) for (const [key, times] of issuedAt) if (!times.some((time) => now - time < 3_600_000)) issuedAt.delete(key);

    try {
      const body = await bodyJson(req, 2048);
      const email = String(body?.email || '').trim().toLowerCase();
      const purpose = body?.purpose === 'claim' ? 'claim' : 'register';
      if (!EMAIL_PATTERN.test(email)) {
        json(res, 400, { error: { message: '邮箱格式不对。' } });
        return true;
      }
      const result = await issue(email, purpose);
      if (result.throttled) {
        json(res, 429, { error: { message: `请 ${result.throttled} 秒后再获取验证码。` }, data: { retry_after: result.throttled } });
        return true;
      }
      json(res, 202, { data: { expires_in: result.expiresInSeconds } });
    } catch (error) {
      // 配置缺失是运维问题，不是用户填错：给 503，前端文案能区分。
      const notConfigured = /SMTP/.test(String(error?.message || ''));
      json(res, notConfigured ? 503 : 400, { error: { message: error.message || '验证码发送失败。' } });
    }
    return true;
  }

  return { handleIssue, issue, verify };
}
