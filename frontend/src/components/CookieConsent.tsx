import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { localizeReact, type Locale } from '../i18n';
import { gpcOptOut } from '../lib/analytics';
import { readConsent, writeConsent } from '../lib/consent';

export default function CookieConsent({ locale = 'en' }: { locale?: Locale }) {
  const [visible, setVisible] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [gpc, setGpc] = useState(false);
  function restoreSavedPreferences() {
    const saved = readConsent();
    setAnalytics(saved?.analytics === true);
    setMarketing(saved?.marketing === true);
  }
  useEffect(() => {
    setVisible(!readConsent());
    restoreSavedPreferences();
    setGpc(gpcOptOut());
    const open = () => { restoreSavedPreferences(); setPreferences(true); setVisible(true); };
    window.addEventListener('hongmeng:open-cookie-settings', open);
    return () => window.removeEventListener('hongmeng:open-cookie-settings', open);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('hm-cookie-open', visible);
    return () => { document.body.classList.remove('hm-cookie-open'); };
  }, [visible]);
  function save(next: { analytics: boolean; marketing: boolean }) {
    writeConsent(next);
    setVisible(false);
    window.dispatchEvent(new CustomEvent('hongmeng:consent-updated', { detail: next }));
  }
  if (!visible) return null;
  return localizeReact(<div className="hm-cookie-backdrop" role="presentation"><section className="hm-cookie-dialog" role="dialog" aria-labelledby="hm-cookie-title" aria-describedby="hm-cookie-description">
    <button type="button" className="hm-cookie-close" aria-label="Close cookie settings" onClick={() => save({ analytics: false, marketing: false })}><X size={18} aria-hidden="true" /></button>
    <div className="hm-cookie-copy">
      <span className="hm-eyebrow">YOUR PRIVACY CHOICES</span>
      <h2 id="hm-cookie-title">Cookie settings</h2>
      <p id="hm-cookie-description">Necessary storage keeps your cart, sign-in, and site security working. Analytics storage is optional and only controls whether we remember this browser: visits are always counted anonymously, with no identifier written. Allow it and repeat visits and chats stay tied to one visitor. You can change this at any time.</p>
      {gpc && <p className="hm-cookie-gpc">Your browser sends a Global Privacy Control signal, so anonymous counting is paused until you allow analytics.</p>}
      <p className="hm-cookie-links"><a href="/privacy/">Privacy policy</a><a href="/cookies/">Cookie policy</a><a href="/privacy/#privacy-choices">Privacy choices</a></p>
    </div>
    {preferences && <div className="hm-cookie-options"><label><input type="checkbox" checked disabled /><span><strong>Essential functions</strong><small>Required for your cart, account, and site security.</small></span><em>Always on</em></label><label><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /><span><strong>Analytics cookies</strong><small>Lets us recognise this browser for repeat visits and chat history. Anonymous counting runs either way.</small></span></label><label><input type="checkbox" checked={false} disabled /><span><strong>Advertising cookies</strong><small>Reserved for advertising tags; none is installed yet.</small></span><em>Not in use</em></label></div>}
    <div className="hm-cookie-actions"><button type="button" className="hm-cookie-secondary" onClick={() => save({ analytics: false, marketing: false })}>Reject optional</button><button type="button" className="hm-cookie-secondary" onClick={() => preferences ? save({ analytics, marketing }) : setPreferences(true)}>{preferences ? 'Save choices' : 'Customize'}</button><button type="button" className="hm-button hm-button-blue" onClick={() => save({ analytics: true, marketing: true })}>Allow all</button></div>
  </section></div>, locale);
}
