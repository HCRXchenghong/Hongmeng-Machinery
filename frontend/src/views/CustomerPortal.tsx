import { useEffect, useState } from 'react';
import { ArrowRight, PackageCheck, ReceiptText, UserRound } from 'lucide-react';
import { formatDate, formatMoney, localizedServerMessage, localizeHref, localizeReact, LocaleProvider, translate, useLocale, type Locale } from '../i18n';

const API = String(import.meta.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');
type User = { id: string; email: string; full_name: string; phone: string; legal_name: string; verification_status: string };
type Address = { id: string; label: string; recipient: string; phone: string; country: string; region: string; city: string; line1: string; line2: string; postal_code: string; is_default: boolean };
type Order = { id: string; order_number: string; shipping_address: Record<string, string>; currency: string; subtotal_cents: number; refunded_cents?: number; shipping_cents: number; tax_cents?: number; total_cents: number; shipping_status: 'quote_pending' | 'quoted' | 'accepted' | 'included' | 'collect'; shipping_accepted_at?: string | null; status: string; payment_status: string; payment_provider: 'manual' | 'stripe' | 'paypal'; tracking_number: string; tracking_url: string; created_at: string; items: Array<{ id?: string; sku?: string; name: string; quantity: number }> };
type Tab = 'orders' | 'addresses' | 'billing' | 'profile' | 'payments';
type EditField = 'name' | 'phone' | 'email' | 'password';
type SavedPaymentMethod = { id: string; brand: string; last4: string; exp_month: number | null; exp_year: number | null; wallet: string | null; is_default: boolean };
type ShopSettings = { payment_provider: 'manual' | 'stripe' | 'paypal'; payment_configured: boolean; payment_methods?: Array<'manual' | 'stripe' | 'paypal'>; quote_payment_methods?: Array<'stripe' | 'paypal'>; currency: 'USD' | 'CNY' };
const ACCOUNT_TABS_META: Array<[Tab, string, string]> = [
  ['orders', 'My orders', 'Orders'],
  ['addresses', 'Shipping addresses', 'Addresses'],
  ['billing', 'My billing', 'Billing'],
  ['profile', 'Account profile', 'Profile'],
  ['payments', 'Payment methods', 'Payments']
];
const ACCOUNT_TABS: Tab[] = ACCOUNT_TABS_META.map(([key]) => key);
const CARD_BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay' };
const WALLET_LABELS: Record<string, string> = { apple_pay: 'Apple Pay', google_pay: 'Google Pay' };
/** 标签写在地址栏里，刷新、回退、分享链接都能停在同一页。 */
function tabFromUrl(): Tab {
  if (typeof window === 'undefined') return 'orders';
  const value = new URLSearchParams(window.location.search).get('tab');
  return value && ACCOUNT_TABS.includes(value as Tab) ? value as Tab : 'orders';
}
const emptyAddress = (): Address => ({ id: '', label: '', recipient: '', phone: '', country: 'United States', region: '', city: '', line1: '', line2: '', postal_code: '', is_default: false });
const statusText = (status: string) => ({ pending: 'Pending', confirmed: 'Confirmed', paid: 'Paid', fulfilling: 'Processing', shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled' }[status] || status);

async function request(locale: Locale, path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { credentials: 'include', ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(localizedServerMessage(locale, payload.error?.message, 'Account request failed.'));
  return payload.data;
}

function Field({ label, value, onChange, required = false, autoComplete, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; autoComplete?: string; type?: string }) {
  const locale = useLocale();
  return localizeReact(<label className="hm-account-field">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} autoComplete={autoComplete} maxLength={300} /></label>, locale);
}

export default function CustomerPortal({ locale = 'en', pagePath = '/account/' }: { locale?: Locale; pagePath?: string }) {
  const money = (cents: number, currency: string = 'USD') => formatMoney(cents, currency === 'CNY' ? 'CNY' : 'USD', locale);
  const localizedPath = (path: string) => localizeHref(locale, path);
  const localizedItemName = (value: string) => locale === 'en' ? value : translate(locale, value);
  const countryLabel = (value: string) => value === 'United States' && locale === 'zh-CN' ? '美国' : value === 'United States' && locale === 'ar' ? 'الولايات المتحدة' : value;
  const countryValue = (value: string) => value === '美国' || value === 'الولايات المتحدة' ? 'United States' : value;
  const pathname = pagePath;
  const loginPage = pathname.includes('/login'); const registerPage = pathname.includes('/register');
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [tab, setTab] = useState<Tab>('orders');
  const [editAddress, setEditAddress] = useState<Address | null>(null);
  const [oauth, setOauth] = useState({ google: false, facebook: false });
  const [credentials, setCredentials] = useState({ email: '', password: '', full_name: '', code: '' });
  const [codeState, setCodeState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [cooldown, setCooldown] = useState(0);
  const [profile, setProfile] = useState({ full_name: '', phone: '' });
  const [editing, setEditing] = useState<EditField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editConfirm, setEditConfirm] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editCodeState, setEditCodeState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [editError, setEditError] = useState('');
  const [billing, setBilling] = useState<Order[]>([]);
  const [shopSettings, setShopSettings] = useState<ShopSettings>({ payment_provider: 'manual', payment_configured: true, payment_methods: ['manual'], currency: 'USD' });
  const [quotePaymentProvider, setQuotePaymentProvider] = useState<'manual' | 'stripe' | 'paypal'>('manual');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [savedMethods, setSavedMethods] = useState<SavedPaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [methodError, setMethodError] = useState('');

  async function loadAccount() {
    const customer = await request(locale, '/site-admin-api/customer/session');
    if (!customer) { setUser(null); return; }
    setUser(customer);
    setProfile({ full_name: customer.full_name || '', phone: customer.phone || '' });
    const [ordersResult, addressResult] = await Promise.all([request(locale, '/site-admin-api/customer/orders'), request(locale, '/site-admin-api/customer/addresses')]);
    setOrders(ordersResult); setAddresses(addressResult);
  }
  useEffect(() => {
    let active = true;
    let translationPoll: number | null = null;
    const updateOrderNames = async () => {
      if (!['zh-CN', 'ar'].includes(locale) || !active) return;
      try {
        const response = await fetch(`${API}/site-admin-api/shop/translated-content?locale=${locale}`, { cache: 'no-store' });
        const snapshot = await response.json();
        if (!active) return;
        if (snapshot?.meta?.status === 'ready' && snapshot?.data) {
          const products = new Map<string, any>();
          for (const product of snapshot.data.products || []) {
            if (product.id) products.set(String(product.id), product);
            if (product.sku) products.set(String(product.sku), product);
          }
          setOrders((current) => current.map((order) => ({ ...order, items: order.items.map((item) => {
            const translated = products.get(String(item.id || '')) || products.get(String(item.sku || ''));
            return translated?.name ? { ...item, name: translated.name } : item;
          }) })));
          if (translationPoll !== null) window.clearInterval(translationPoll);
          translationPoll = null;
        } else if (['unconfigured', 'failed'].includes(snapshot?.meta?.status)) {
          if (translationPoll !== null) window.clearInterval(translationPoll);
          translationPoll = null;
        } else if (translationPoll === null) {
          translationPoll = window.setInterval(() => { void updateOrderNames(); }, 3000);
        }
      } catch {
        if (active && translationPoll === null) translationPoll = window.setInterval(() => { void updateOrderNames(); }, 3000);
      }
    };
    Promise.all([request(locale, '/site-admin-api/customer/config').then(setOauth).catch(() => {})]);
    fetch(`${API}/site-admin-api/shop/settings`).then((response) => response.json()).then((payload) => { if (payload.data) { setShopSettings(payload.data); setQuotePaymentProvider(payload.data.quote_payment_methods?.[0] || 'manual'); } }).catch(() => {});
    if (!loginPage && !registerPage) loadAccount().then(() => updateOrderNames()).catch(() => {}).finally(() => setLoading(false)); else setLoading(false);
    return () => { active = false; if (translationPoll !== null) window.clearInterval(translationPoll); };
  }, []);
  // 读取地址栏里的 ?tab=，并支持浏览器前进/后退在标签之间切换。
  useEffect(() => {
    if (loginPage || registerPage) return;
    const applyTab = () => {
      const next = tabFromUrl();
      setTab(next);
      if (next === 'billing') void loadBilling();
      if (next === 'payments') void loadPaymentMethods();
    };
    applyTab();
    window.addEventListener('popstate', applyTab);
    return () => window.removeEventListener('popstate', applyTab);
  }, []);
  // 资料弹窗按 Esc 关闭。
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditing(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  async function submitAuth(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      await request(locale, `/site-admin-api/customer/${registerPage ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(credentials) });
      location.assign(localizedPath('/account/'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); }
  }
  async function sendCode() {
    setError('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(credentials.email)) return setError('Please enter a valid email address first.');
    setCodeState('sending');
    try {
      await request(locale, '/site-admin-api/customer/email-code', { method: 'POST', body: JSON.stringify({ email: credentials.email, purpose: 'register' }) });
      setCodeState('sent');
      setCooldown(60);
    } catch (cause) {
      setCodeState('idle');
      setError(cause instanceof Error ? cause.message : 'Could not send the code.');
    }
  }
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function openEdit(kind: EditField) {
    setEditing(kind); setEditError(''); setEditCode(''); setEditCodeState('idle'); setEditConfirm('');
    setCooldown(0);
    setEditValue(kind === 'name' ? profile.full_name : kind === 'phone' ? profile.phone : kind === 'email' ? String(user?.email || '') : '');
  }
  function closeEdit() { setEditing(null); setEditError(''); }
  async function sendEditCode() {
    setEditError('');
    const target = editing === 'email' ? editValue.trim().toLowerCase() : String(user?.email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) return setEditError('Please enter a valid email address first.');
    setEditCodeState('sending');
    try {
      await request(locale, '/site-admin-api/customer/email-code', { method: 'POST', body: JSON.stringify({ email: target, purpose: editing === 'email' ? 'email-change' : 'password-change' }) });
      setEditCodeState('sent');
      setCooldown(60);
    } catch (cause) {
      setEditCodeState('idle');
      setEditError(cause instanceof Error ? cause.message : 'Could not send the code.');
    }
  }
  async function saveEdit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return; setEditError(''); setNotice('');
    const body: Record<string, unknown> = { full_name: profile.full_name, phone: profile.phone, email: String(user?.email || '') };
    if (editing === 'name') {
      if (!editValue.trim()) return setEditError('Name cannot be empty.');
      body.full_name = editValue.trim();
    }
    if (editing === 'phone') body.phone = editValue.trim();
    if (editing === 'email') {
      const next = editValue.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) return setEditError('Please enter a valid email address.');
      if (next === String(user?.email || '').toLowerCase()) return closeEdit();
      if (!editCode.trim()) return setEditError('Please enter the verification code.');
      body.email = next; body.email_code = editCode;
    }
    if (editing === 'password') {
      if (editValue.length < 12) return setEditError('New password must be at least 12 characters.');
      if (editValue !== editConfirm) return setEditError('Passwords do not match.');
      if (!editCode.trim()) return setEditError('Please enter the verification code.');
      body.new_password = editValue; body.password_code = editCode;
    }
    try {
      const saved = await request(locale, '/site-admin-api/customer/me', { method: 'PATCH', body: JSON.stringify(body) });
      setUser(saved);
      setProfile({ full_name: saved.full_name || '', phone: saved.phone || '' });
      setEditing(null);
      setNotice('Your profile has been saved.');
      window.dispatchEvent(new CustomEvent('hongmeng:customer-updated'));
    } catch (cause) { setEditError(cause instanceof Error ? cause.message : 'Could not save your changes.'); }
  }

  async function saveAddress(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editAddress) return;
    setError(''); setNotice('');
    try {
      const { id, ...body } = editAddress;
      await request(locale, `/site-admin-api/customer/addresses${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setAddresses(await request(locale, '/site-admin-api/customer/addresses')); setEditAddress(null); setNotice('Your shipping address has been saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your changes.'); }
  }
  async function deleteAddress(id: string) {
    if (!confirm(translate(locale, 'Delete this shipping address?'))) return;
    try { await request(locale, `/site-admin-api/customer/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }); setAddresses(await request(locale, '/site-admin-api/customer/addresses')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this address.'); }
  }
  async function loadBilling() { try { setBilling(await request(locale, '/site-admin-api/customer/billing')); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load billing history.'); } }
  async function loadPaymentMethods() {
    setMethodsLoading(true); setMethodError('');
    try { setSavedMethods(await request(locale, '/site-admin-api/customer/payment-methods')); }
    catch (cause) { setMethodError(cause instanceof Error ? cause.message : 'Could not load payment methods.'); }
    finally { setMethodsLoading(false); setMethodsLoaded(true); }
  }
  async function removePaymentMethod(id: string) {
    if (!confirm(translate(locale, 'Delete this payment method?'))) return;
    setMethodError(''); setNotice('');
    try {
      await request(locale, `/site-admin-api/customer/payment-methods/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadPaymentMethods();
      setNotice('Payment method deleted.');
    } catch (cause) { setMethodError(cause instanceof Error ? cause.message : 'Could not delete this payment method.'); }
  }
  async function managePayment() {
    setError('');
    try { const result = await request(locale, '/site-admin-api/customer/payment-portal', { method: 'POST', body: JSON.stringify({ locale }) }); location.assign(result.url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open payment settings.'); }
  }
  async function acceptShippingQuote(order: Order) {
    setError(''); setNotice('');
    const provider = order.payment_status === 'pending' && order.payment_provider !== 'manual' ? order.payment_provider : quotePaymentProvider;
    try {
      const result = await request(locale, `/site-admin-api/shop/orders/${encodeURIComponent(order.id)}/accept-shipping`, { method: 'POST', body: JSON.stringify({ payment_provider: provider }) });
      if (result.url) { location.assign(result.url); return; }
      setNotice('Shipping quote accepted. Our team will follow up about payment.');
      await loadAccount();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not accept the shipping quote.'); }
  }
  function switchTab(next: Tab) {
    setTab(next); setError('');
    const url = new URL(window.location.href);
    if (next === 'orders') url.searchParams.delete('tab'); else url.searchParams.set('tab', next);
    window.history.pushState({ tab: next }, '', url);
    if (next === 'billing') void loadBilling();
    if (next === 'payments') void loadPaymentMethods();
  }
  const paymentMethods = shopSettings.payment_methods || [shopSettings.payment_provider];
  const quotePaymentMethods = shopSettings.quote_payment_methods || [];

  return <LocaleProvider locale={locale}>{localizeReact(<div className="hm-account-page hm-section">
    <div className="hm-page-heading"><span className="hm-eyebrow">HONGMENG CUSTOMER ACCOUNT</span><h1>{loginPage ? 'Welcome back' : registerPage ? 'Create account' : 'My account'}</h1><p>Manage orders, shipping addresses, and account details.</p></div>
    {loading ? <p className="hm-state">Loading your account…</p> : (loginPage || registerPage) ? <div className="hm-auth-card"><div className="hm-auth-icon"><UserRound size={28} /></div><h2>{registerPage ? 'Create a Hongmeng Machinery account' : 'Sign in to Hongmeng Machinery'}</h2><form onSubmit={submitAuth}>
      {registerPage && <Field label="Full name" value={credentials.full_name} onChange={(full_name) => setCredentials({ ...credentials, full_name })} required autoComplete="name" />}
      <label className="hm-account-field">Email address<input required type="email" autoComplete="email" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} /></label>
      {registerPage && <label className="hm-account-field">Email verification code<span className="hm-code-row"><input required inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={credentials.code} onChange={(event) => setCredentials({ ...credentials, code: event.target.value.replace(/\D/g, '') })} /><button type="button" className="hm-code-send" onClick={sendCode} disabled={codeState === 'sending' || cooldown > 0}>{cooldown > 0 ? `Resend in ${cooldown}s` : codeState === 'sending' ? 'Sending…' : 'Send code'}</button></span>{codeState === 'sent' && <small className="hm-code-hint">Code sent, valid 10 minutes.</small>}</label>}
      <label className="hm-account-field">Password<input required type="password" autoComplete={registerPage ? 'new-password' : 'current-password'} minLength={registerPage ? 12 : 1} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />{registerPage && <small>Use at least 12 characters. We will never ask for your password by email.</small>}</label>
      {error && <p className="hm-error" role="alert">{error}</p>}<button className="hm-button hm-button-blue" type="submit">{registerPage ? 'Create account' : 'Sign in'} <ArrowRight size={17} /></button>
    </form>{(oauth.google || oauth.facebook) && <><div className="hm-auth-separator">Or continue with a social account</div>
      {oauth.google && <a className="hm-oauth-button" href={`${API}/site-admin-api/customer/oauth/google${locale !== 'en' ? `?locale=${encodeURIComponent(locale)}` : ''}`}>Continue with Google</a>}
      {oauth.facebook && <a className="hm-oauth-button" href={`${API}/site-admin-api/customer/oauth/facebook${locale !== 'en' ? `?locale=${encodeURIComponent(locale)}` : ''}`}>Continue with Facebook</a>}</>}
      <p className="hm-auth-switch">{registerPage ? <>Already have an account? <a href="/account/login/">Sign in</a></> : <>New here? <a href="/account/register/">Create account</a></>}</p>
    </div> : !user ? <div className="hm-auth-card hm-account-gate"><PackageCheck size={34} /><h2>Sign in to view your orders</h2><p>Create an account to save shipping addresses and track Hongmeng Machinery orders.</p><a className="hm-button hm-button-blue" href={localizedPath('/account/login/')}>Sign in to your account</a><a href={localizedPath('/account/register/')}>Create account</a><div className="hm-auth-separator">Or</div><div className="hm-account-guest">Continue as a guest<a href={localizedPath('/shop/')}>Return to the shop</a></div>{(oauth.google || oauth.facebook) && <div className="hm-account-social">{oauth.google && <a href={`${API}/site-admin-api/customer/oauth/google${locale !== 'en' ? `?locale=${encodeURIComponent(locale)}` : ''}`}>Google</a>}{oauth.facebook && <a href={`${API}/site-admin-api/customer/oauth/facebook${locale !== 'en' ? `?locale=${encodeURIComponent(locale)}` : ''}`}>Facebook</a>}</div>}</div> : <>
      {error && <p role="alert" className="hm-error">{error}</p>}{notice && <p role="status" className="hm-account-notice">{notice}</p>}
      <div className="hm-account-layout"><nav className="hm-account-tabs">{ACCOUNT_TABS_META.map(([key, label, short]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => switchTab(key)}><span className="hm-tab-full">{label}</span><span className="hm-tab-compact">{short}</span></button>)}<a className="hm-account-tabs-back" href={localizedPath('/shop/')}>Back to the shop</a></nav>
        <section className="hm-account-content">
          {tab === 'orders' && <><h2>My orders</h2>{orders.length ? <div className="hm-account-list">{orders.map((order) => <article className="hm-order-card" key={order.id}><header><strong>{order.order_number}</strong><span>{formatDate(order.created_at, locale)}</span></header><p>{order.items?.map((item) => `${localizedItemName(item.name)} × ${item.quantity}`).join(', ')}</p><div className="hm-order-card-bottom"><strong>{order.shipping_status === 'quote_pending' ? money(order.subtotal_cents, order.currency) : money(order.total_cents, order.currency)}</strong><span>{statusText(order.status)} · {order.payment_status === 'refunded' ? 'Refunded' : order.payment_status === 'partially_refunded' ? `Partially refunded (${money(Number(order.refunded_cents || 0), order.currency)})` : order.payment_status === 'paid' ? 'Paid' : 'Unpaid'}</span></div>{order.shipping_status === 'quote_pending' && <p className="hm-tracking">Shipping is being quoted. Final order total will be confirmed before payment.</p>}{order.shipping_status === 'collect' && <p className="hm-tracking">Freight is collect on delivery.</p>}{['quoted','accepted'].includes(order.shipping_status) && <><p className="hm-tracking">Shipping: {money(order.shipping_cents, order.currency)} · Final total: {money(order.total_cents, order.currency)}{order.shipping_accepted_at ? ' · Quote accepted' : ' · Please review and accept this quote'}</p>{order.status !== 'cancelled' && order.payment_status !== 'paid' && ((order.shipping_status === 'quoted' && !order.shipping_accepted_at) || (order.shipping_status === 'accepted' && quotePaymentMethods.length > 0)) && <div className="hm-inline-actions"><label>Payment method <select value={order.payment_status === 'pending' && order.payment_provider !== 'manual' ? order.payment_provider : quotePaymentProvider} disabled={order.payment_status === 'pending' && order.payment_provider !== 'manual'} onChange={(event) => setQuotePaymentProvider(event.target.value as 'manual' | 'stripe' | 'paypal')}><option value="manual">Manual payment confirmation</option>{quotePaymentMethods.map((provider) => <option key={provider} value={provider}>{provider === 'stripe' ? 'Credit or debit card (Stripe)' : 'PayPal'}</option>)}</select></label><button className="hm-button hm-button-blue" type="button" onClick={() => acceptShippingQuote(order)}>{(order.payment_status === 'pending' && order.payment_provider !== 'manual' ? order.payment_provider : quotePaymentProvider) === 'manual' ? order.shipping_accepted_at ? 'Confirm quote accepted' : 'Accept shipping quote' : order.shipping_accepted_at ? 'Continue to secure payment' : 'Accept quote and continue to payment'}</button></div>}</>}{Number(order.tax_cents || 0) > 0 && <p className="hm-tracking">Tax (Stripe Tax): {money(Number(order.tax_cents), order.currency)} · Total: {money(order.total_cents, order.currency)}</p>}
            {order.tracking_number && <p className="hm-tracking">Tracking number: <strong>{order.tracking_number}</strong>{order.tracking_url && <> · <a href={order.tracking_url} target="_blank" rel="noreferrer">Track shipment</a></>}</p>}</article>)}</div> : <div className="hm-account-empty"><PackageCheck size={30} /><p>You do not have any orders yet.</p><a className="hm-button hm-button-blue" href={localizedPath('/shop/')}>Browse products</a></div>}</>}
          {tab === 'addresses' && <><div className="hm-account-heading-row"><h2>Shipping addresses</h2><button className="hm-button hm-button-blue" type="button" onClick={() => setEditAddress(emptyAddress())}>Add address</button></div>{editAddress && <form className="hm-account-form" onSubmit={saveAddress}><div className="hm-form-row"><Field label="Address label" value={editAddress.label} onChange={(label) => setEditAddress({ ...editAddress, label })} /><Field label="Recipient" value={editAddress.recipient} onChange={(recipient) => setEditAddress({ ...editAddress, recipient })} required /></div><div className="hm-form-row"><Field label="Phone" value={editAddress.phone} onChange={(phone) => setEditAddress({ ...editAddress, phone })} required /><Field label="Country" value={countryLabel(editAddress.country)} onChange={(country) => setEditAddress({ ...editAddress, country: countryValue(country) })} /></div><div className="hm-form-row"><Field label="State / region" value={editAddress.region} onChange={(region) => setEditAddress({ ...editAddress, region })} /><Field label="City" value={editAddress.city} onChange={(city) => setEditAddress({ ...editAddress, city })} required /></div><Field label="Street address" value={editAddress.line1} onChange={(line1) => setEditAddress({ ...editAddress, line1 })} required /><Field label="Address line 2" value={editAddress.line2} onChange={(line2) => setEditAddress({ ...editAddress, line2 })} /><div className="hm-form-row"><Field label="ZIP code" value={editAddress.postal_code} onChange={(postal_code) => setEditAddress({ ...editAddress, postal_code })} required /><label className="hm-account-check"><input type="checkbox" checked={editAddress.is_default} onChange={(event) => setEditAddress({ ...editAddress, is_default: event.target.checked })} />Set as default address</label></div><div className="hm-inline-actions"><button className="hm-button hm-button-blue" type="submit">Save address</button><button type="button" onClick={() => setEditAddress(null)}>Cancel</button></div></form>}{addresses.map((address) => <article className="hm-address-card" key={address.id}><div><strong>{address.label || address.recipient} {address.is_default && <em>Default</em>}</strong><p>{address.recipient} · {address.phone}<br />{[address.line1,address.line2,address.city,address.region,address.postal_code,address.country].filter(Boolean).join(', ')}</p></div><div className="hm-inline-actions"><button type="button" onClick={() => setEditAddress(address)}>Edit</button><button type="button" onClick={() => deleteAddress(address.id)}>Delete</button></div></article>)}</>}
          {tab === 'billing' && <><h2>Billing history</h2>{billing.length ? <div className="hm-account-list">{billing.map((item) => <article className="hm-order-card" key={item.id}><header><strong>{item.order_number}</strong><span>{formatDate(item.created_at, locale)}</span></header><div className="hm-order-card-bottom"><strong>{item.shipping_status === 'quote_pending' ? money(item.subtotal_cents,item.currency) : money(item.total_cents,item.currency)}</strong><span>{item.shipping_status === 'quote_pending' ? 'Final amount pending shipping quote' : item.shipping_status === 'quoted' ? item.shipping_accepted_at ? 'Quote accepted' : 'Awaiting quote acceptance' : item.payment_status === 'paid' ? 'Paid' : 'Awaiting payment'}</span></div>{Number(item.tax_cents || 0) > 0 && <p className="hm-tracking">Tax: {money(Number(item.tax_cents), item.currency)}</p>}{Number(item.refunded_cents || 0) > 0 && <p className="hm-tracking">Refunded: {money(Number(item.refunded_cents), item.currency)}</p>}
            {item.shipping_status === 'quote_pending' && <p className="hm-tracking">Shipping has not been quoted yet, so this is the product subtotal rather than the amount due.</p>}</article>)}</div> : <div className="hm-account-empty"><ReceiptText size={30} /><p>No billing history yet.</p></div>}</>}
          {tab === 'profile' && <><h2>Account profile</h2>
            <div className="hm-profile-list">
              {([['name', 'Full name', profile.full_name || '—'], ['phone', 'Phone number', profile.phone || '—'], ['email', 'Email address', String(user?.email || '—')], ['password', 'Password', '••••••••']] as Array<[EditField, string, string]>).map(([key, label, value]) => <div className="hm-profile-row" key={key}>
                <div><small>{label}</small><strong>{value}</strong></div>
                <button className="hm-profile-edit" type="button" onClick={() => openEdit(key)}>Change</button>
              </div>)}
            </div>
            {editing && <div className="hm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEdit(); }}>
              <form className="hm-modal" role="dialog" aria-modal="true" aria-label={editing === 'name' ? 'Full name' : editing === 'phone' ? 'Phone number' : editing === 'email' ? 'Email address' : 'Password'} onSubmit={saveEdit}>
                <h3>{editing === 'name' ? 'Full name' : editing === 'phone' ? 'Phone number' : editing === 'email' ? 'New email address' : 'Password'}</h3>
                {editing === 'name' && <Field label="Full name" value={editValue} onChange={setEditValue} required autoComplete="name" />}
                {editing === 'phone' && <Field label="Phone number" value={editValue} onChange={setEditValue} autoComplete="tel" />}
                {editing === 'email' && <Field label="New email address" type="email" value={editValue} onChange={setEditValue} required autoComplete="email" />}
                {editing === 'password' && <>
                  <Field label="New password" type="password" value={editValue} onChange={setEditValue} required autoComplete="new-password" />
                  <Field label="Confirm new password" type="password" value={editConfirm} onChange={setEditConfirm} required autoComplete="new-password" />
                  <p className="hm-muted">Use at least 12 characters.</p>
                </>}
                {(editing === 'email' || editing === 'password') && <label className="hm-account-field">Verification code
                  <span className="hm-code-row"><input inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={editCode} onChange={(event) => setEditCode(event.target.value.replace(/\D/g, ''))} /><button type="button" className="hm-code-send" onClick={sendEditCode} disabled={editCodeState === 'sending' || cooldown > 0}>{cooldown > 0 ? `Resend in ${cooldown}s` : editCodeState === 'sending' ? 'Sending…' : 'Send code'}</button></span>
                  {editing === 'password' && <small>{user?.email}</small>}
                  {editCodeState === 'sent' && <small>Code sent, valid 10 minutes.</small>}
                </label>}
                {editError && <p className="hm-error" role="alert">{editError}</p>}
                <div className="hm-modal-actions"><button className="hm-modal-cancel" type="button" onClick={closeEdit}>Cancel</button><button className="hm-button hm-button-blue" type="submit">Save</button></div>
              </form>
            </div>}
          </>}
          {tab === 'payments' && <div className="hm-account-payments">
            <h2>Payment methods</h2>
            <p>Payment details are stored by the payment provider. Hongmeng Machinery does not receive your full card number.</p>
            {methodsLoading && !methodsLoaded ? <p className="hm-state">Loading payment methods…</p>
              : savedMethods.length ? <ul className="hm-payment-list">{savedMethods.map((method) => <li className="hm-payment-row" key={method.id}>
                <span className="hm-payment-brand">{translate(locale, CARD_BRANDS[method.brand] || 'Card')}</span>
                <span className="hm-payment-masked">•••• {method.last4}</span>
                {method.exp_month && method.exp_year && <span className="hm-payment-exp">{`${String(method.exp_month).padStart(2, '0')}/${String(method.exp_year).slice(-2)}`}</span>}
                {method.is_default && <em className="hm-payment-default">Default</em>}
                {method.wallet && <span className="hm-payment-wallet">{WALLET_LABELS[method.wallet] || method.wallet}</span>}
                <button className="hm-payment-delete" type="button" onClick={() => removePaymentMethod(method.id)}>Delete</button>
              </li>)}</ul>
              : methodsLoaded ? <p className="hm-payment-empty">No saved payment methods yet.</p> : null}
            {methodError && <p className="hm-error" role="alert">{methodError}</p>}
            {paymentMethods.includes('stripe') && <button className="hm-button hm-button-blue" type="button" onClick={managePayment}>Add payment method</button>}
            {paymentMethods.includes('paypal') && <p className="hm-payment-note">PayPal manages your cards and funding sources. Update them in your PayPal Wallet settings. <a href="https://www.paypal.com/myaccount/settings/" target="_blank" rel="noreferrer">Open PayPal settings</a></p>}
          </div>}
        </section>
      </div>
    </>}
    <p className="hm-account-legal"><a href="/privacy/">Privacy policy</a> · <a href="/terms/">Sales terms</a></p>
  </div>, locale)}</LocaleProvider>;
}
