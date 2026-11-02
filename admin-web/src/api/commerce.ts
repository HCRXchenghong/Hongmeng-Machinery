import client from './client';

export type ProductShippingZone = { id: string; name: string; countries: string[]; mode: 'flat' | 'free' | 'collect' | 'manual'; amount_cents: number; active: boolean };
export type ProductShippingRules = { mode: 'inherit' | 'collect' | 'manual'; zones: ProductShippingZone[] };
export type ShopProduct = {
  id: string; sku: string; slug: string; category: string; name: string;
  summary: string; description: string; image_url: string; gallery: string[];
  highlights: string[]; specifications: Array<{ label: string; value: string }>; faqs: Array<{ question: string; answer: string }>; videos: Array<string | { url: string; type?: 'video'; autoplay?: boolean; muted?: boolean; youtubeLink?: string }>; currency: 'USD' | 'CNY';
  price_cents: number; stock: number; allow_backorder: boolean; active: boolean; featured: boolean; sort_order: number; shipping_rules?: ProductShippingRules;
};

export type ShopOrder = {
  id: string; order_number: string; customer_name: string; email: string; phone: string;
  shipping_address: Record<string, string>; items: Array<{ name: string; quantity: number; line_total_cents: number }>;
  subtotal_cents: number; shipping_cents: number; total_cents: number;
  shipping_status: 'quote_pending' | 'quoted' | 'accepted' | 'included'; shipping_accepted_at?: string | null; shipping_quoted_at?: string | null;
  status: string; note: string; tracking_number: string; tracking_url: string; currency: string; payment_status: string; payment_provider: string; tax_cents?: number; refunded_cents?: number; refunded_at?: string | null; refunded_by?: string; refund_request?: { id: string; reason: string; contact_phone: string; status: string; requested_at: string; refunded_cents?: number } | null; created_at: string;
};
export type ShopCustomer = { id: string; email: string; full_name: string; phone: string; legal_name: string; verification_status: string; created_at: string; order_count: number; paid_totals: Record<string, number | string>; addresses?: Array<{ id: string; label: string; recipient: string; phone: string; country: string; region: string; city: string; line1: string; line2: string; postal_code: string; is_default: boolean }> };

const base = '/site-admin-api/commerce';
export const listProducts = () => client.get<{ data: ShopProduct[] }>(`${base}/products`).then((r) => r.data.data);
export const createProduct = (product: ShopProduct) => client.post(`${base}/products`, product).then((r) => r.data.data);
export const updateProduct = (product: ShopProduct) => client.put(`${base}/products/${encodeURIComponent(product.id)}`, product).then((r) => r.data.data);
export const listOrders = () => client.get<{ data: ShopOrder[] }>(`${base}/orders`).then((r) => r.data.data);
export const updateOrder = (id: string, body: { status: string; tracking_number: string; tracking_url: string; shipping_cents?: number }) => client.patch(`${base}/orders/${encodeURIComponent(id)}`, body).then((r) => r.data.data);
export const refundOrder = (id: string, body: { email: string; password: string; reason?: string; amount_cents?: number }) =>
  client.post(`${base}/orders/${encodeURIComponent(id)}/refund`, body).then((r) => r.data.data);

export const listCustomers = () => client.get<{ data: ShopCustomer[] }>(`${base}/customers`).then((r) => r.data.data);
export const updateCustomer = (customer: Pick<ShopCustomer,'id'|'full_name'|'phone'|'legal_name'>) => client.patch(`${base}/customers/${encodeURIComponent(customer.id)}`, customer).then((r) => r.data.data);
export type ShippingZone = { id: string; name: string; countries: string[]; mode: 'quote' | 'flat'; amount_cents: number; active: boolean };
export type CommerceSettings = { shipping_mode: 'quote' | 'flat'; shipping_cents: number; shipping_zones?: ShippingZone[]; checkout_enabled: boolean; support_email: string; currency: 'USD' | 'CNY'; payment_provider: 'manual' | 'stripe' | 'paypal'; payment_configured?: boolean };
export const getSettings = () => client.get<{ data: CommerceSettings }>(`${base}/settings`).then((r) => r.data.data);
export const updateSettings = (settings: CommerceSettings) => client.patch(`${base}/settings`, settings).then((r) => r.data.data);
export type CommercePolicies = { privacy_policy: string; cookie_policy: string; terms_policy: string; shipping_policy: string; returns_policy: string };
export const getPolicies = () => client.get<{ data: CommercePolicies }>(`${base}/policies`).then((r) => r.data.data);
export const updatePolicies = (policies: CommercePolicies) => client.patch(`${base}/policies`, policies).then((r) => r.data.data);
export type StorefrontContent = Record<string, any>;
export const getStorefrontContent = () => client.get<{ data: StorefrontContent }>(`${base}/storefront`).then((r) => r.data.data);
export const updateStorefrontContent = (content: StorefrontContent) => client.patch(`${base}/storefront`, { content }).then((r) => r.data.data);
export type CommerceIntegrationStatus = { google_configured: boolean; facebook_configured: boolean; stripe_configured: boolean; paypal_configured: boolean };
export const getIntegrationStatus = () => client.get<{ data: CommerceIntegrationStatus }>('/site-admin-api/commerce/integrations').then((r) => r.data.data);
export const updateIntegrations = (body: { oauth_secrets?: Record<string, string>; payment_secrets?: Record<string, string> }) => client.patch('/site-admin-api/commerce/integrations', body).then((r) => r.data.data);

// ---------- 新官网 SEO（AI 生成 + 人工修改共用同一份结构） ----------
export type StorefrontSeoPage = { title: string; description: string; keywords: string; image: string };
export type StorefrontSeo = { pages: Record<string, StorefrontSeoPage> };
export const getStorefrontSeo = () =>
  client.get<{ data: StorefrontSeo }>(`${base}/seo`).then((r) => r.data.data);
export const updateStorefrontSeo = (seo: StorefrontSeo) =>
  client.patch<{ data: StorefrontSeo }>(`${base}/seo`, { seo }).then((r) => r.data.data);
export const generateStorefrontSeo = () =>
  client
    .post<{ data: StorefrontSeo; meta?: { generated?: number } }>(`${base}/seo/ai-generate`)
    .then((r) => r.data);
