import { MessageCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { htmlLang, localizeReact, type Locale } from '../i18n';
import { trackEvent } from '../lib/analytics';
import { VISITOR_KEY, consentState } from '../lib/consent';

const VISITOR_SESSION_KEY = 'hongmeng_service_visitor_session_v1';
type Props = { serviceBridgeUrl?: string; serviceBridgeApiUrl?: string; locale?: Locale };

export default function ChatWidget({ serviceBridgeUrl = '', serviceBridgeApiUrl = '', locale = 'en' }: Props) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visitorRef, setVisitorRef] = useState('');
  const [forget, setForget] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => {
    // 构建时没注入 PUBLIC_SERVICEBRIDGE_* 会回落成 127.0.0.1，局域网/线上访客就看不到客服窗口。
    // 这里做一次兜底改写：回落的 host 若指向本机、而页面不是从本机打开的，就换成页面自己的 host。
    const pageHost = typeof window === 'undefined' ? '' : window.location.hostname;
    const rewriteLocalhost = (value: string) => {
      try {
        const parsed = new URL(value);
        const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
        if (local && pageHost && pageHost !== '127.0.0.1' && pageHost !== 'localhost') {
          parsed.hostname = pageHost;
        }
        return parsed.toString().replace(/\/$/, '');
      } catch {
        return value;
      }
    };
    const base = rewriteLocalhost((serviceBridgeUrl || import.meta.env.PUBLIC_SERVICEBRIDGE_URL || 'http://127.0.0.1:5175').replace(/\/$/, ''));
    const apiBase = rewriteLocalhost((serviceBridgeApiUrl || import.meta.env.PUBLIC_SERVICEBRIDGE_API_URL || 'http://127.0.0.1:8081').replace(/\/$/, ''));
    const url = new URL(base);
    url.searchParams.set('embed', '1');
    url.searchParams.set('lang', htmlLang(locale));
    url.searchParams.set('api_base', apiBase);
    if (visitorRef) url.searchParams.set('visitor_ref', visitorRef);
    // 撤回同意后让挂件清掉它自己那份存储，否则旧会话令牌会绕过撤回继续被使用。
    if (forget) url.searchParams.set('forget', '1');
    return url.toString();
  }, [serviceBridgeUrl, serviceBridgeApiUrl, locale, visitorRef, forget]);

  useEffect(() => {
    const readVisitor = () => {
      try {
        const value = window.localStorage.getItem(VISITOR_KEY) || '';
        setVisitorRef(/^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : '');
      } catch {
        setVisitorRef('');
      }
      setForget(consentState() === 'rejected');
    };
    readVisitor();
    window.addEventListener('hongmeng:consent-updated', readVisitor);
    return () => window.removeEventListener('hongmeng:consent-updated', readVisitor);
  }, []);

  useEffect(() => {
    const origin = new URL(src).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === 'servicebridge:ready') setReady(true);
      if (event.data?.type === 'servicebridge:conversation-closed') setOpen(false);
      if (event.data?.type === 'servicebridge:session-get') {
        let session = null;
        try { session = JSON.parse(localStorage.getItem(VISITOR_SESSION_KEY) || 'null'); } catch { session = null; }
        event.source?.postMessage({ type: 'servicebridge:session-restore', session }, event.origin);
      }
      if (event.data?.type === 'servicebridge:session-put' && event.data.session?.visitorToken && event.data.session?.conversationId) {
        localStorage.setItem(VISITOR_SESSION_KEY, JSON.stringify(event.data.session));
      }
      if (event.data?.type === 'servicebridge:session-clear') localStorage.removeItem(VISITOR_SESSION_KEY);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src]);

  return localizeReact(<div className="hm-chat-launcher" data-chat-launcher>
    {open && <section className="hm-chat-panel" aria-label="Customer support">
      <iframe ref={iframe} src={src} title="Hongmeng Machinery customer support" allow="microphone; camera; clipboard-write" onError={() => setFailed(true)} />
      {!ready && !failed && <div className="hm-chat-loading">Connecting to support…</div>}
      {failed && <div className="hm-chat-loading">Support is temporarily unavailable. Please send us a message on the Contact page.</div>}
    </section>}
    <button type="button" className="hm-chat-button" aria-label={open ? 'Close support' : 'Open support'} onClick={() => { const next = !open; setOpen(next); setFailed(false); if (next) trackEvent('chat_open'); }}>
      {open ? <X size={25} /> : <MessageCircle size={25} />}
    </button>
  </div>, locale);
}
