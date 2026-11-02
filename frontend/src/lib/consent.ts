/**
 * Cookie 选择记录。
 *
 * 只存「最小必要」的选择本身：必要标记、两个可选项、时间戳、版本与过期时间。
 * 版本或过期不匹配时视同没同意过（弹窗会重新出现），并把此前写入的可选标识清掉。
 */
export const CONSENT_KEY = 'hongmeng_cookie_consent_v1';
export const CONSENT_VERSION = 2;
/** 选择的有效期：到期后重新征求一次同意。 */
export const CONSENT_TTL_DAYS = 180;

/** 可选标识（仅在同意 analytics 后写入）。 */
export const VISITOR_KEY = 'astreva_visitor_id';
export const SESSION_KEY = 'astreva_session_id';
/** 客服会话恢复用；属于必要存储，但牵连访客画像，撤回时一并清掉。 */
export const CHAT_SESSION_KEY = 'hongmeng_service_visitor_session_v1';

export type Consent = {
  version: number;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
  expiresAt: string;
};

/** granted：已同意 analytics；rejected：明确拒绝；unknown：还没选过。 */
export type ConsentState = 'granted' | 'rejected' | 'unknown';

function remove(key: string, store: Storage | null) {
  try {
    store?.removeItem(key);
  } catch {
    /* 隐私模式下可能不可写 */
  }
}

/** 清掉所有可选标识：拒绝或过期后不再保留可跨天关联的 ID。 */
export function clearOptionalIdentifiers(): void {
  if (typeof window === 'undefined') return;
  remove(VISITOR_KEY, window.localStorage);
  remove(SESSION_KEY, window.sessionStorage);
  remove(CHAT_SESSION_KEY, window.localStorage);
}

function isValid(value: Partial<Consent> | null, now: number): value is Consent {
  if (!value) return false;
  if (value.necessary !== true) return false;
  if (typeof value.analytics !== 'boolean' || typeof value.marketing !== 'boolean') return false;
  if (value.version !== CONSENT_VERSION) return false;
  const expires = Date.parse(String(value.expiresAt || ''));
  return Number.isFinite(expires) && expires > now;
}

export function readConsent(): Consent | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: Partial<Consent> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<Consent>;
  } catch {
    parsed = null;
  }
  if (isValid(parsed, Date.now())) return parsed;
  // 过期 / 旧版本 / 损坏：丢弃记录并清掉可选标识，让弹窗重新出现。
  remove(CONSENT_KEY, window.localStorage);
  clearOptionalIdentifiers();
  return null;
}

export function consentState(): ConsentState {
  const consent = readConsent();
  if (!consent) return 'unknown';
  return consent.analytics ? 'granted' : 'rejected';
}

/** 写入新的选择；拒绝时立刻清掉可选标识。 */
export function writeConsent(next: { analytics: boolean; marketing: boolean }): Consent {
  const consent: Consent = {
    version: CONSENT_VERSION,
    necessary: true,
    analytics: next.analytics,
    marketing: next.marketing,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CONSENT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  };
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    /* 存不住时本次会话内仍然生效 */
  }
  if (!consent.analytics) clearOptionalIdentifiers();
  return consent;
}
