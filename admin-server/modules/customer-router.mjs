import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const COOKIE = 'hongmeng_customer_session';
const OAUTH_COOKIE = 'hm_oauth_state';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value, max = 255) => String(value ?? '').trim().slice(0, max);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function cookieHeader(name, value, maxAge, req, { httpOnly = true } = {}) {
  const secure = process.env.SESSION_COOKIE_SECURE === 'true' || (process.env.SESSION_COOKIE_SECURE !== 'false' && (process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https'));
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge};${httpOnly ? ' HttpOnly;' : ''}${secure ? ' Secure;' : ''}`;
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((pair) => pair.trim().split(/=(.*)/s, 2)).filter(([key, value]) => key && value != null).map(([key, value]) => [key, decodeURIComponent(value)]));
}

export function createCustomerRouter({ store, bodyJson, json, applyPublicCors, siteOrigin, apiOrigin = process.env.PUBLIC_ADMIN_URL || process.env.PUBLIC_ADMIN_ORIGIN || siteOrigin, verifySession, verification = null, requestIp = null }) {
  const authAttempts = new Map();
  const oauthStates = new Map();

  async function runtimeSecrets() {
    const [auth, payments] = await Promise.all([
      Promise.resolve(store.readRuntimeSetting ? store.readRuntimeSetting('shop-auth') : null).catch(() => null),
      Promise.resolve(store.readRuntimeSetting ? store.readRuntimeSetting('shop-payments') : null).catch(() => null)
    ]);
    return { auth: auth?.secrets || {}, payment: payments?.secrets || {} };
  }
  function oauthConfig(provider, secrets) {
    if (provider === 'google') return { clientId: process.env.GOOGLE_CLIENT_ID || secrets.googleClientId, clientSecret: process.env.GOOGLE_CLIENT_SECRET || secrets.googleClientSecret };
    return { clientId: process.env.FACEBOOK_CLIENT_ID || secrets.facebookClientId, clientSecret: process.env.FACEBOOK_CLIENT_SECRET || secrets.facebookClientSecret };
  }
  function publicCustomer(customer) {
    return { id: customer.id, email: customer.email, full_name: customer.full_name, phone: customer.phone, legal_name: customer.legal_name || '', verification_status: customer.verification_status || 'unverified', created_at: customer.created_at };
  }
  async function currentCustomer(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const result = await store.query('SELECT c.* FROM shop_customer_sessions s JOIN shop_customers c ON c.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at > now()', [hash(token)]);
    return result.rows[0] || null;
  }
  async function createSession(req, res, customerId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await store.query('INSERT INTO shop_customer_sessions (token_hash, customer_id, expires_at) VALUES ($1,$2,now()+interval \'30 days\')', [hash(token), customerId]);
    res.setHeader('Set-Cookie', cookieHeader(COOKIE, token, 30 * 24 * 60 * 60, req));
  }
  function rateLimit(req, email) {
    const key = `${(requestIp ? requestIp(req) : '') || req.socket?.remoteAddress || 'unknown'}:${email}`;
    const current = (authAttempts.get(key) || []).filter((time) => Date.now() - time < 15 * 60_000);
    if (current.length >= 8) throw error('尝试次数过多，请 15 分钟后再试。', 429);
    current.push(Date.now()); authAttempts.set(key, current);
  }
  function validateAddress(body) {
    const address = {
      label: clean(body.label, 80), recipient: clean(body.recipient, 120), phone: clean(body.phone, 60),
      country: clean(body.country || 'United States', 80), region: clean(body.region, 100), city: clean(body.city, 100),
      line1: clean(body.line1, 300), line2: clean(body.line2, 300), postal_code: clean(body.postal_code, 30), is_default: body.is_default === true
    };
    if (!address.recipient || !address.phone || !address.city || !address.line1 || !address.postal_code) throw error('请填写收件人、电话、城市、街道地址和邮编。');
    return address;
  }
  async function setDefaultAddress(customerId, addressId) {
    await store.withTransaction(async (client) => {
      await client.query('UPDATE shop_customer_addresses SET is_default=false, updated_at=now() WHERE customer_id=$1', [customerId]);
      await client.query('UPDATE shop_customer_addresses SET is_default=true, updated_at=now() WHERE id=$1 AND customer_id=$2', [addressId, customerId]);
    });
  }

  return async function handleCustomer(req, res, pathname) {
    const oauthStart = pathname.match(/^\/site-admin-api\/customer\/oauth\/(google|facebook)$/);
    const oauthCallback = pathname.match(/^\/site-admin-api\/customer\/oauth\/(google|facebook)\/callback$/);
    const adminIntegrations = pathname === '/site-admin-api/commerce/integrations';
    if (!pathname.startsWith('/site-admin-api/customer/') && !adminIntegrations) return false;
    if (adminIntegrations && !verifySession(req)) { json(res, 401, { error: { message: '请先登录。' } }); return true; }
    const isOAuthBrowserFlow = Boolean(oauthStart || oauthCallback);
    if (!isOAuthBrowserFlow && !adminIntegrations) {
      if (!applyPublicCors(req, res)) { json(res, 403, { error: { message: '当前来源不允许访问账户服务。' } }); return true; }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
    }
    try {
      if (adminIntegrations && req.method === 'GET') {
        const { auth, payment } = await runtimeSecrets();
        json(res, 200, { data: {
          google_configured: Boolean(process.env.GOOGLE_CLIENT_ID || auth.googleClientId) && Boolean(process.env.GOOGLE_CLIENT_SECRET || auth.googleClientSecret),
          facebook_configured: Boolean(process.env.FACEBOOK_CLIENT_ID || auth.facebookClientId) && Boolean(process.env.FACEBOOK_CLIENT_SECRET || auth.facebookClientSecret),
          stripe_configured: Boolean((process.env.STRIPE_SECRET_KEY || payment.stripeSecret) && (process.env.STRIPE_WEBHOOK_SECRET || payment.stripeWebhookSecret)),
          paypal_configured: Boolean((process.env.PAYPAL_CLIENT_ID || payment.paypalClientId) && (process.env.PAYPAL_CLIENT_SECRET || payment.paypalClientSecret) && (process.env.PAYPAL_WEBHOOK_ID || payment.paypalWebhookId))
        } }); return true;
      }
      if (adminIntegrations && req.method === 'PATCH') {
        const body = await bodyJson(req, 8192); const current = await runtimeSecrets();
        const auth = { ...current.auth }; const payment = { ...current.payment };
        const authFields = ['googleClientId', 'googleClientSecret', 'facebookClientId', 'facebookClientSecret'];
        const paymentFields = ['stripeSecret', 'stripeWebhookSecret', 'paypalClientId', 'paypalClientSecret', 'paypalWebhookId', 'paypalMode'];
        for (const key of authFields) if (typeof body.oauth_secrets?.[key] === 'string' && body.oauth_secrets[key].trim()) auth[key] = body.oauth_secrets[key].trim().slice(0, 500);
        for (const key of paymentFields) if (typeof body.payment_secrets?.[key] === 'string' && body.payment_secrets[key].trim()) payment[key] = body.payment_secrets[key].trim().slice(0, 500);
        if (Object.keys(auth).length) await store.saveRuntimeSetting('shop-auth', { config: {}, secrets: auth });
        if (Object.keys(payment).length) await store.saveRuntimeSetting('shop-payments', { config: {}, secrets: payment });
        json(res, 200, { data: { ok: true } }); return true;
      }
      if (oauthStart) {
        const provider = oauthStart[1];
        const { auth } = await runtimeSecrets();
        const config = oauthConfig(provider, auth);
        if (!config.clientId || !config.clientSecret) throw error(`请先配置 ${provider === 'google' ? 'GOOGLE' : 'FACEBOOK'} OAuth Client ID 和 Secret。`, 503);
        const state = crypto.randomBytes(32).toString('base64url');
        const requestedLocale = new URL(req.url || '/', siteOrigin).searchParams.get('locale');
        const locale = requestedLocale === 'zh-CN' || requestedLocale === 'ar' ? requestedLocale : 'en';
        oauthStates.set(hash(state), { provider, locale, expires: Date.now() + 10 * 60_000 });
        res.setHeader('Set-Cookie', cookieHeader(OAUTH_COOKIE, state, 600, req));
        const callback = `${apiOrigin.replace(/\/$/, '')}/site-admin-api/customer/oauth/${provider}/callback`;
        const target = provider === 'google'
          ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
          : new URL('https://www.facebook.com/v21.0/dialog/oauth');
        target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: callback, response_type: 'code', state, ...(provider === 'google' ? { scope: 'openid email profile', prompt: 'select_account' } : { scope: 'email,public_profile' }) }).toString();
        res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' }); res.end(); return true;
      }
      if (oauthCallback) {
        const provider = oauthCallback[1];
        const url = new URL(req.url || '/', siteOrigin);
        const state = url.searchParams.get('state') || '';
        const stateCookie = cookies(req)[OAUTH_COOKIE] || '';
        const stateRecord = oauthStates.get(hash(state)); oauthStates.delete(hash(state));
        res.setHeader('Set-Cookie', [cookieHeader(OAUTH_COOKIE, '', 0, req), cookieHeader(COOKIE, '', 0, req)]);
        if (!state || state !== stateCookie || !stateRecord || stateRecord.provider !== provider || stateRecord.expires < Date.now()) throw error('社交登录校验已失效，请重新开始。', 401);
        if (url.searchParams.has('error')) throw error('您已取消或无法完成社交登录。', 401);
        const code = url.searchParams.get('code'); if (!code) throw error('OAuth 回调缺少授权码。', 400);
        const { auth } = await runtimeSecrets(); const config = oauthConfig(provider, auth);
        const callback = `${apiOrigin.replace(/\/$/, '')}/site-admin-api/customer/oauth/${provider}/callback`;
        let identity;
        if (provider === 'google') {
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callback, grant_type: 'authorization_code' }) });
          const token = await tokenResponse.json(); if (!tokenResponse.ok || !token.access_token) throw error('Google 登录验证失败。', 401);
          const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
          identity = await profileResponse.json();
          if (!profileResponse.ok || identity.email_verified !== true) throw error('Google 账号未提供已验证邮箱。', 401);
          identity.subject = identity.sub; identity.full_name = identity.name || '';
        } else {
          const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
          tokenUrl.search = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callback }).toString();
          const tokenResponse = await fetch(tokenUrl); const token = await tokenResponse.json();
          if (!tokenResponse.ok || !token.access_token) throw error('Facebook 登录验证失败。', 401);
          const profileUrl = new URL('https://graph.facebook.com/me'); profileUrl.search = new URLSearchParams({ fields: 'id,name,email', access_token: token.access_token }).toString();
          const profileResponse = await fetch(profileUrl); identity = await profileResponse.json();
          if (!profileResponse.ok || !EMAIL.test(identity.email || '')) throw error('Facebook 账号未提供可用邮箱。', 401);
          identity.subject = identity.id; identity.full_name = identity.name || '';
        }
        const email = clean(identity.email, 180).toLowerCase(); const subject = clean(identity.subject, 180);
        let customer = (await store.query('SELECT c.* FROM shop_customer_identities i JOIN shop_customers c ON c.id=i.customer_id WHERE i.provider=$1 AND i.subject=$2', [provider, subject])).rows[0];
        if (!customer) {
          customer = (await store.query('SELECT * FROM shop_customers WHERE lower(email)=lower($1)', [email])).rows[0];
          // Google 回的是 email_verified 的地址；Facebook 的主邮箱也是验证过的，两者都直接记 verified。
          if (!customer) customer = (await store.query("INSERT INTO shop_customers (id,email,full_name,verification_status) VALUES ($1,$2,$3,'verified') RETURNING *", [crypto.randomUUID(), email, clean(identity.full_name, 120)])).rows[0];
          await store.query('INSERT INTO shop_customer_identities (provider,subject,customer_id) VALUES ($1,$2,$3) ON CONFLICT (provider,subject) DO NOTHING', [provider, subject, customer.id]);
        }
        await createSession(req, res, customer.id);
        const accountPrefix = stateRecord.locale === 'zh-CN' ? '/zh' : stateRecord.locale === 'ar' ? '/ar' : '';
        const accountPath = `${accountPrefix}/account/`;
        res.writeHead(302, { Location: `${siteOrigin.replace(/\/$/, '')}${accountPath}`, 'Cache-Control': 'no-store' }); res.end(); return true;
      }
      if (pathname === '/site-admin-api/customer/config' && req.method === 'GET') {
        const { auth } = await runtimeSecrets();
        json(res, 200, { data: { google: Boolean(process.env.GOOGLE_CLIENT_ID || auth.googleClientId) && Boolean(process.env.GOOGLE_CLIENT_SECRET || auth.googleClientSecret), facebook: Boolean(process.env.FACEBOOK_CLIENT_ID || auth.facebookClientId) && Boolean(process.env.FACEBOOK_CLIENT_SECRET || auth.facebookClientSecret) } }); return true;
      }
      if (pathname === '/site-admin-api/customer/session' && req.method === 'GET') {
        const customer = await currentCustomer(req);
        json(res, 200, { data: customer ? publicCustomer(customer) : null }); return true;
      }
      if (pathname === '/site-admin-api/customer/register' && req.method === 'POST') {
        const body = await bodyJson(req, 8192); const email = clean(body.email, 180).toLowerCase(); const password = String(body.password || '');
        rateLimit(req, email);
        if (!EMAIL.test(email) || password.length < 12 || password.length > 128) throw error('请使用有效邮箱，并设置至少 12 位密码。');
        const fullName = clean(body.full_name, 120); if (!fullName) throw error('请填写姓名。');
        // 先挡重复邮箱，别白白消耗一条验证码。
        const taken = await store.query('SELECT id FROM shop_customers WHERE lower(email)=lower($1)', [email]);
        if (taken.rows[0]) throw error('这个邮箱已经有账户了，直接登录即可。', 409);
        // 邮箱必须先收到验证码：既挡住乱填的邮箱，也让「认领历史订单」有依据。
        if (verification) {
          const checked = await verification.verify(email, body.code);
          if (!checked.ok) throw error(checked.reason || '验证码不正确。', 400);
        }
        const digest = await bcrypt.hash(password, 12);
        let customer;
        try {
          customer = (await store.query("INSERT INTO shop_customers (id,email,password_hash,full_name,verification_status) VALUES ($1,$2,$3,$4,'verified') RETURNING *", [crypto.randomUUID(), email, digest, fullName])).rows[0];
        } catch (insertError) {
          // 并发注册同一邮箱会撞唯一键。
          if (String(insertError?.code) === '23505') throw error('这个邮箱已经有账户了，直接登录即可。', 409);
          throw insertError;
        }
        await createSession(req, res, customer.id);
        // 认领同邮箱的历史游客订单，注册后能看到之前用这个邮箱下过的单。
        await store.query('UPDATE shop_orders SET customer_id=$1, updated_at=now() WHERE customer_id IS NULL AND lower(email)=lower($2)', [customer.id, email]).catch(() => {});
        json(res, 201, { data: publicCustomer(customer) }); return true;
      }
      if (pathname === '/site-admin-api/customer/claim' && req.method === 'POST') {
        const body = await bodyJson(req, 8192); const email = clean(body.email, 180).toLowerCase(); const password = String(body.password || '');
        rateLimit(req, email);
        if (!EMAIL.test(email) || password.length < 12 || password.length > 128) throw error('请使用有效邮箱，并设置至少 12 位密码。');
        const existing = await store.query('SELECT id FROM shop_customers WHERE lower(email)=lower($1)', [email]);
        if (existing.rows[0]) {
          throw error('这个邮箱已经有账户了，直接登录即可看到订单。', 409);
        }
        if (verification) {
          const checked = await verification.verify(email, body.code);
          if (!checked.ok) throw error(checked.reason || '验证码不正确。', 400);
        }
        const fullName = clean(body.full_name, 120) || email.split('@')[0];
        const digest = await bcrypt.hash(password, 12);
        let customer;
        try {
          customer = (await store.query("INSERT INTO shop_customers (id,email,password_hash,full_name,verification_status) VALUES ($1,$2,$3,$4,'verified') RETURNING *", [crypto.randomUUID(), email, digest, fullName])).rows[0];
        } catch (insertError) {
          if (String(insertError?.code) === '23505') throw error('这个邮箱已经有账户了，直接登录即可看到订单。', 409);
          throw insertError;
        }
        const claimed = await store.query('UPDATE shop_orders SET customer_id=$1, updated_at=now() WHERE customer_id IS NULL AND lower(email)=lower($2) RETURNING id', [customer.id, email]);
        await createSession(req, res, customer.id);
        json(res, 201, { data: { ...publicCustomer(customer), claimed_orders: claimed.rows.length } });
        return true;
      }

      if (pathname === '/site-admin-api/customer/login' && req.method === 'POST') {
        const body = await bodyJson(req, 8192); const email = clean(body.email, 180).toLowerCase(); rateLimit(req, email);
        const customer = (await store.query('SELECT * FROM shop_customers WHERE lower(email)=lower($1)', [email])).rows[0];
        if (!customer?.password_hash || !(await bcrypt.compare(String(body.password || ''), customer.password_hash))) throw error('邮箱或密码不正确。', 401);
        await createSession(req, res, customer.id);
        await store.query('UPDATE shop_orders SET customer_id=$1, updated_at=now() WHERE customer_id IS NULL AND lower(email)=lower($2)', [customer.id, email]).catch(() => {});
        json(res, 200, { data: publicCustomer(customer) }); return true;
      }
      if (pathname === '/site-admin-api/customer/logout' && req.method === 'POST') {
        const token = cookies(req)[COOKIE]; if (token) await store.query('DELETE FROM shop_customer_sessions WHERE token_hash=$1', [hash(token)]);
        res.setHeader('Set-Cookie', cookieHeader(COOKIE, '', 0, req)); json(res, 200, { data: { ok: true } }); return true;
      }
      const customer = await currentCustomer(req);
      if (pathname === '/site-admin-api/customer/me' && req.method === 'GET') { if (!customer) throw error('请先登录。', 401); json(res, 200, { data: publicCustomer(customer) }); return true; }
      if (pathname === '/site-admin-api/customer/me' && req.method === 'PATCH') {
        if (!customer) throw error('请先登录。', 401);
        const body = await bodyJson(req, 8192); const fullName = clean(body.full_name, 120); const phone = clean(body.phone, 60);
        if (!fullName) throw error('姓名不能为空。');
        const email = clean(body.email, 180).toLowerCase() || customer.email;
        const currentPassword = String(body.current_password || ''); const passwordCode = String(body.password_code || ''); const newPassword = String(body.new_password || '');
        // 改密码：优先用当前邮箱收到的验证码；兼容老流程的「当前密码」。
        let passwordHash = customer.password_hash || '';
        if (newPassword) {
          if (newPassword.length < 12 || newPassword.length > 128) throw error('新密码至少 12 位。');
          if (passwordCode) {
            if (!verification) throw error('当前环境未启用邮箱验证。', 503);
            const checked = await verification.verify(customer.email, passwordCode);
            if (!checked.ok) throw error(checked.reason || '验证码不正确。', 400);
          } else if (customer.password_hash && !(await bcrypt.compare(currentPassword, customer.password_hash))) {
            throw error('请填写邮箱验证码或当前密码。', 403);
          }
          passwordHash = await bcrypt.hash(newPassword, 12);
        }
        // 改邮箱：新邮箱要先收到验证码，且不能和别的账户重复。
        if (email !== String(customer.email || '').toLowerCase()) {
          if (!EMAIL.test(email)) throw error('请填写有效邮箱。');
          if (!verification) throw error('当前环境未启用邮箱验证。', 503);
          const checked = await verification.verify(email, body.email_code);
          if (!checked.ok) throw error(checked.reason || '验证码不正确。', 400);
          const taken = await store.query('SELECT id FROM shop_customers WHERE lower(email)=lower($1) AND id<>$2', [email, customer.id]);
          if (taken.rows[0]) throw error('这个邮箱已经被其他账户使用。', 409);
        }
        const updated = (await store.query('UPDATE shop_customers SET full_name=$2,phone=$3,email=$4,password_hash=$5,updated_at=now() WHERE id=$1 RETURNING *', [customer.id, fullName, phone, email, passwordHash])).rows[0];
        // 改过密码或登录邮箱就把其它会话踢下线：被盗的旧会话不会跟着一直有效。
        if ((newPassword && passwordHash !== customer.password_hash) || email !== String(customer.email || '').toLowerCase()) {
          const currentToken = cookies(req)[COOKIE];
          await store.query('DELETE FROM shop_customer_sessions WHERE customer_id=$1 AND token_hash<>$2', [customer.id, hash(currentToken || '')]);
        }
        json(res, 200, { data: publicCustomer(updated) }); return true;
      }
      if (pathname === '/site-admin-api/customer/addresses' && req.method === 'GET') {
        if (!customer) throw error('请先登录。', 401);
        const result = await store.query('SELECT * FROM shop_customer_addresses WHERE customer_id=$1 ORDER BY is_default DESC,created_at DESC', [customer.id]); json(res, 200, { data: result.rows }); return true;
      }
      if (pathname === '/site-admin-api/customer/addresses' && req.method === 'POST') {
        if (!customer) throw error('请先登录。', 401);
        const address = validateAddress(await bodyJson(req, 8192)); const id = crypto.randomUUID();
        const result = await store.withTransaction(async (client) => {
          const count = Number((await client.query('SELECT count(*)::int AS count FROM shop_customer_addresses WHERE customer_id=$1', [customer.id])).rows[0].count);
          if (count >= 20) throw error('最多保存 20 个收货地址。');
          const isDefault = address.is_default || count === 0;
          if (isDefault) await client.query('UPDATE shop_customer_addresses SET is_default=false WHERE customer_id=$1', [customer.id]);
          return client.query('INSERT INTO shop_customer_addresses (id,customer_id,label,recipient,phone,country,region,city,line1,line2,postal_code,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [id,customer.id,address.label,address.recipient,address.phone,address.country,address.region,address.city,address.line1,address.line2,address.postal_code,isDefault]);
        }); json(res, 201, { data: result.rows[0] }); return true;
      }
      const addressMatch = pathname.match(/^\/site-admin-api\/customer\/addresses\/([^/]+)$/);
      if (addressMatch && req.method === 'PUT') {
        if (!customer) throw error('请先登录。', 401);
        const address = validateAddress(await bodyJson(req, 8192));
        const result = await store.withTransaction(async (client) => {
          if (address.is_default) await client.query('UPDATE shop_customer_addresses SET is_default=false WHERE customer_id=$1', [customer.id]);
          return client.query('UPDATE shop_customer_addresses SET label=$3,recipient=$4,phone=$5,country=$6,region=$7,city=$8,line1=$9,line2=$10,postal_code=$11,is_default=$12,updated_at=now() WHERE id=$1 AND customer_id=$2 RETURNING *', [addressMatch[1],customer.id,address.label,address.recipient,address.phone,address.country,address.region,address.city,address.line1,address.line2,address.postal_code,address.is_default]);
        }); if (!result.rows[0]) throw error('收货地址不存在。', 404); json(res, 200, { data: result.rows[0] }); return true;
      }
      if (addressMatch && req.method === 'DELETE') {
        if (!customer) throw error('请先登录。', 401);
        const result = await store.query('DELETE FROM shop_customer_addresses WHERE id=$1 AND customer_id=$2 RETURNING id', [addressMatch[1], customer.id]); if (!result.rowCount) throw error('收货地址不存在。', 404); json(res, 200, { data: { ok: true } }); return true;
      }
      if (pathname === '/site-admin-api/customer/orders' && req.method === 'GET') {
        if (!customer) throw error('请先登录。', 401);
        const result = await store.query('SELECT id,order_number,shipping_address,items,currency,subtotal_cents,shipping_cents,tax_cents,refunded_cents,total_cents,shipping_status,shipping_accepted_at,status,payment_status,payment_provider,tracking_number,tracking_url,created_at,updated_at FROM shop_orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 200', [customer.id]); json(res, 200, { data: result.rows }); return true;
      }
      if (pathname === '/site-admin-api/customer/billing' && req.method === 'GET') {
        if (!customer) throw error('请先登录。', 401);
        const result = await store.query('SELECT id,order_number,currency,subtotal_cents,shipping_cents,tax_cents,refunded_cents,total_cents,shipping_status,shipping_accepted_at,payment_status,payment_provider,provider_payment_id,created_at FROM shop_orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 200', [customer.id]); json(res, 200, { data: result.rows }); return true;
      }
      if (pathname === '/site-admin-api/customer/payment-portal' && req.method === 'POST') {
        if (!customer) throw error('请先登录。', 401);
        const { payment } = await runtimeSecrets(); const key = process.env.STRIPE_SECRET_KEY || payment.stripeSecret;
        if (!key) throw error('暂未配置 Stripe 安全支付资料管理。', 503);
        const portalBody = await bodyJson(req, 8192).catch(() => ({}));
        let stripeCustomerId = customer.payment_customer_id || '';
        if (!stripeCustomerId) {
          const createResponse = await fetch('https://api.stripe.com/v1/customers', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: customer.email, name: customer.full_name, 'metadata[hongmeng_customer_id]': customer.id }) });
          const created = await createResponse.json(); if (!createResponse.ok || !created.id) throw error('无法在支付服务商创建安全客户资料。', 502);
          stripeCustomerId = created.id;
          await store.query('UPDATE shop_customers SET payment_customer_id=$2 WHERE id=$1', [customer.id, stripeCustomerId]);
        }
        // 回到账户页的「付款方式」标签，用户管理完卡片不会掉回「我的订单」。
        const accountPrefix = portalBody.locale === 'zh-CN' ? '/zh' : portalBody.locale === 'ar' ? '/ar' : '';
        const form = new URLSearchParams({ customer: stripeCustomerId, return_url: `${siteOrigin.replace(/\/$/, '')}${accountPrefix}/account/?tab=payments` });
        const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
        const result = await response.json(); if (!response.ok) throw error('无法打开支付服务商的卡片管理页面。', 502);
        json(res, 200, { data: { url: result.url } }); return true;
      }
      if (pathname === '/site-admin-api/customer/payment-methods' && req.method === 'GET') {
        if (!customer) throw error('请先登录。', 401);
        const { payment } = await runtimeSecrets(); const key = process.env.STRIPE_SECRET_KEY || payment.stripeSecret;
        // 没配置 Stripe 时对前台就是「没有已保存的支付方式」，不要弹出错误。
        if (!key) { json(res, 200, { data: [] }); return true; }
        const stripeCustomerId = customer.payment_customer_id || '';
        // 读接口不主动创建 Stripe 客户：还没在支付服务商留下资料时就是空列表。
        if (!stripeCustomerId) { json(res, 200, { data: [] }); return true; }
        const headers = { Authorization: `Bearer ${key}` };
        const [methodsResponse, customerResponse] = await Promise.all([
          fetch(`https://api.stripe.com/v1/payment_methods?customer=${encodeURIComponent(stripeCustomerId)}&type=card&limit=20`, { headers }),
          fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(stripeCustomerId)}`, { headers }).catch(() => null)
        ]);
        const methods = await methodsResponse.json().catch(() => ({}));
        if (!methodsResponse.ok) throw error('无法读取支付服务商的支付方式。', 502);
        const profile = customerResponse && customerResponse.ok ? await customerResponse.json().catch(() => ({})) : {};
        const defaultMethodId = profile?.invoice_settings?.default_payment_method || '';
        json(res, 200, { data: (Array.isArray(methods.data) ? methods.data : []).filter((method) => method?.card).map((method) => ({ id: method.id, brand: method.card.brand || 'card', last4: method.card.last4 || '', exp_month: method.card.exp_month || null, exp_year: method.card.exp_year || null, wallet: method.card.wallet?.type || null, is_default: method.id === defaultMethodId })) });
        return true;
      }
      const paymentMethodMatch = pathname.match(/^\/site-admin-api\/customer\/payment-methods\/([^/]+)$/);
      if (paymentMethodMatch && req.method === 'DELETE') {
        if (!customer) throw error('请先登录。', 401);
        const { payment } = await runtimeSecrets(); const key = process.env.STRIPE_SECRET_KEY || payment.stripeSecret;
        if (!key) throw error('暂未配置 Stripe 安全支付资料管理。', 503);
        if (!customer.payment_customer_id) throw error('支付方式不存在。', 404);
        const id = paymentMethodMatch[1];
        const headers = { Authorization: `Bearer ${key}` };
        // 先确认这张卡属于当前客户，避免用别人的 payment method id 越权解绑。
        const ownedResponse = await fetch(`https://api.stripe.com/v1/payment_methods/${encodeURIComponent(id)}`, { headers });
        const owned = await ownedResponse.json().catch(() => ({}));
        const ownerId = typeof owned.customer === 'string' ? owned.customer : owned.customer?.id;
        if (!ownedResponse.ok || !ownerId || ownerId !== customer.payment_customer_id) throw error('支付方式不存在。', 404);
        const detachResponse = await fetch(`https://api.stripe.com/v1/payment_methods/${encodeURIComponent(id)}/detach`, { method: 'POST', headers });
        if (!detachResponse.ok) {
          const failure = await detachResponse.json().catch(() => ({}));
          throw error(failure?.error?.message || '无法删除这个支付方式。', 502);
        }
        json(res, 200, { data: { ok: true } }); return true;
      }
      json(res, 405, { error: { message: '不支持的客户账户接口或方法。' } }); return true;
    } catch (cause) {
      const status = cause.status || (cause.code === '23505' ? 409 : 500);
      json(res, status, { error: { message: status >= 500 ? '账户服务暂时不可用，请稍后重试。' : cause.message } }); return true;
    }
  };
}
