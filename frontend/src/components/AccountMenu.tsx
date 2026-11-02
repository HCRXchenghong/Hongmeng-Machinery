import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { localizeHref, translate, type Locale } from '../i18n';

const API = String(import.meta.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');
type Customer = { id: string; email: string; full_name?: string };

/** 顶栏用户入口：未登录时直接去登录页，已登录时点开显示邮箱并提供退出登录。 */
export default function AccountMenu({ locale = 'en' }: { locale?: Locale }) {
  const [user, setUser] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () => fetch(`${API}/site-admin-api/customer/session`, { credentials: 'include' })
      .then((response) => response.json())
      .then((payload) => { if (active) setUser(payload?.data || null); })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    void load();
    // 账户资料改了姓名/邮箱后，顶栏弹窗不用刷新就能同步。
    const refresh = () => { void load(); };
    window.addEventListener('hongmeng:customer-updated', refresh);
    return () => { active = false; window.removeEventListener('hongmeng:customer-updated', refresh); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function logout() {
    await fetch(`${API}/site-admin-api/customer/logout`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    location.assign(localizeHref(locale, '/account/login/'));
  }

  const label = translate(locale, 'My account');
  if (!ready || !user) {
    return <a className="hm-account-action" href={localizeHref(locale, '/account/login/')} aria-label={label}><UserRound size={23} /></a>;
  }

  return <div className="hm-account-menu" ref={root}>
    <button className="hm-account-action hm-account-menu-button" type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><UserRound size={23} /></button>
    {open && <div className="hm-account-menu-panel" role="dialog" aria-label={label}>
      <div className="hm-account-menu-user">
        {user.full_name && <strong>{user.full_name}</strong>}
        <span>{user.email}</span>
      </div>
      <button className="hm-account-menu-signout" type="button" onClick={logout}>{translate(locale, 'Sign out')}</button>
    </div>}
  </div>;
}
