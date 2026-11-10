/**
 * 官网第一方访问上报。
 *
 * 选择只决定「记不记得住这个人」，不决定「记不记」：
 * - unknown（还没选）与 rejected：发匿名 pageview，浏览器端不写任何标识，
 *   服务端按当日盐 + 归并 IP 派生 anon id（仅当日去重、跨天不可关联）；
 * - granted：使用持久 visitor_id（同时写给客服挂件做 visitor_ref），访问路径与聊天画像才落到同一访客；
 * - 例外：浏览器带 Global Privacy Control 信号且访客还没明确同意时，连匿名上报也停。
 * 上报失败静默，不影响页面。
 */
import { SESSION_KEY, VISITOR_KEY, consentState } from './consent';

const API = String(import.meta.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');
/** 服务端签发的一次性删除令牌（HMAC(visitor_id)）：光知道 visitor_id 删不掉别人的明细。 */
export const FORGET_TOKEN_KEY = 'hongmeng_forget_token_v1';

function randomId(prefix: string) {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}${crypto.randomUUID()}`;
  } catch {
    /* ignore */
  }
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function analyticsAllowed(): boolean {
  return consentState() === 'granted';
}

/** 访客浏览器是否通过 Sec-GPC 声明了“不出售/共享”；明确同意后以同意为准。 */
export function gpcOptOut(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function visitorId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY) || '';
    if (existing && /^[A-Za-z0-9_.-]{1,64}$/.test(existing)) return existing;
    const next = randomId('vis_');
    window.localStorage.setItem(VISITOR_KEY, next);
    return next;
  } catch {
    return '';
  }
}

function sessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY) || '';
    if (existing) return existing;
    const next = randomId('ses_');
    window.sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return '';
  }
}

/** 用户刚同意分析 Cookie 时先补写 visitor_id，聊天挂件下一次打开就能带上 visitor_ref。 */
export function primeVisitorId(): string {
  return analyticsAllowed() ? visitorId() : '';
}

export function trackEvent(eventType: 'pageview' | 'chat_open' = 'pageview'): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const allowed = consentState() === 'granted';
  // GPC 是“别记我”的信号：只在访客还没明确同意时才生效，同意优先。
  if (!allowed && gpcOptOut()) return Promise.resolve();
  const visitor = allowed ? visitorId() : '';
  const body: Record<string, unknown> = {
    path: `${window.location.pathname}${window.location.search}`,
    host: window.location.host,
    referrer: document.referrer || '',
    event_type: eventType,
    anonymous: !allowed
  };
  if (allowed && visitor) {
    body.visitor_id = visitor;
    body.session_id = sessionId();
  }
  try {
    return fetch(`${API}/site-admin-api/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      keepalive: true
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { forget_token?: string } | null) => {
        const token = String(payload?.forget_token || '');
        if (/^[0-9a-f]{32}$/.test(token)) window.localStorage.setItem(FORGET_TOKEN_KEY, token);
      })
      .catch(() => undefined)
      .then(() => undefined);
  } catch {
    /* 上报失败不影响页面 */
    return Promise.resolve();
  }
}

/**
 * 等服务端把 HttpOnly 同意 Cookie 种下来再继续（下单前用）。
 * 埋点本身失败也不阻塞：下单接口还有时间戳兜底，这里最多等 2 秒。
 */
export async function ensureConsentCookie(): Promise<void> {
  if (typeof window === 'undefined') return;
  primeVisitorId();
  await Promise.race([trackEvent('pageview'), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

export function trackPageview(): void {
  trackEvent('pageview');
}
