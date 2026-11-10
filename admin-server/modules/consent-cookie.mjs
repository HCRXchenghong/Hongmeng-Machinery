import crypto from 'node:crypto';

/**
 * 同意凭据 Cookie：由埋点接口在「已同意」时签发，HttpOnly —— 页面 JS（以及 XSS）读不到、改不了，
 * 下单接口据此认定同意确实发生过。签名带时间戳，12 小时过期，避免拿旧凭据反复下单。
 */

const CONSENT_COOKIE = 'hm_consent';
export const CONSENT_MAX_AGE_MS = 12 * 60 * 60_000;

function secret() {
  return String(process.env.ADMIN_ANALYTICS_CONSENT_SECRET || process.env.ADMIN_2FA_SESSION_SECRET || process.env.CMS_DATA_ENCRYPTION_KEY || 'astreva-consent-secret');
}

export function signConsent(visitorId, at = Date.now()) {
  const payload = `${visitorId}.${at}`;
  return `${payload}.${crypto.createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 32)}`;
}

export function readConsentCookie(req) {
  const raw = String(req?.headers?.cookie || '');
  const found = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  if (!found) return null;
  let value = found.slice(CONSENT_COOKIE.length + 1);
  try {
    value = decodeURIComponent(value);
  } catch {
    // 客户端把 % 写坏了也不能让下单接口 500，当作没有凭据处理。
  }
  // 从右边切：visitor_id 本身可能带点（前端允许 [A-Za-z0-9_.-]），按点全量切会错位。
  const lastDot = value.lastIndexOf('.');
  const prevDot = lastDot > 0 ? value.lastIndexOf('.', lastDot - 1) : -1;
  if (prevDot <= 0) return null;
  const visitorId = value.slice(0, prevDot);
  const at = value.slice(prevDot + 1, lastDot);
  const signature = value.slice(lastDot + 1);
  if (!visitorId || !at || !signature) return null;
  const expected = crypto.createHmac('sha256', secret()).update(`${visitorId}.${at}`).digest('hex').slice(0, 32);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  if (Date.now() - Number(at) > CONSENT_MAX_AGE_MS) return null;
  return { visitorId, at: Number(at) };
}

export function consentCookieHeader(visitorId) {
  // 与客户会话 Cookie 同样的口径：生产环境（或显式要求）加 Secure，本地 http 不加。
  const secure =
    process.env.SESSION_COOKIE_SECURE === 'true' ||
    (process.env.SESSION_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  const value = encodeURIComponent(signConsent(visitorId));
  return `${CONSENT_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(CONSENT_MAX_AGE_MS / 1000)}${secure ? '; Secure' : ''}`;
}
