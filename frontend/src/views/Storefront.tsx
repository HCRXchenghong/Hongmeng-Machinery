import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Headphones, Menu, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, Truck, UserRound, X } from 'lucide-react';
import { Card, Drawer } from 'flowbite-react';
import MediaCarousel, { type StoreMedia } from '../components/MediaCarousel';
import SocialIcon, { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from '../components/SocialIcon';
import { DEFAULT_POLICIES_AR } from '../i18n/policies-ar';
import type { CartLine, PaymentProvider, Product } from '../lib/storefront-types';
import { FORGET_TOKEN_KEY, ensureConsentCookie, primeVisitorId, trackPageview } from '../lib/analytics';
import { CONSENT_KEY, VISITOR_KEY, clearOptionalIdentifiers, consentState, writeConsent } from '../lib/consent';
import {
  formatMoney,
  localizedServerMessage,
  localizeProduct,
  localizeReact,
  LocaleProvider,
  localePrefix,
  useLocale,
  type Locale
} from '../i18n';

export type Mode = 'home' | 'shop' | 'product' | 'cart' | 'about' | 'solutions' | 'contact' | 'news' | 'privacy' | 'cookies' | 'terms' | 'shipping' | 'returns' | 'not-found';

const generatedProductImages = [
  { src: '/assets/generated/product-hm38.webp', title: '38-inch drum mulcher', keywords: '38-inch 38-inch hm38' },
  { src: '/assets/generated/product-hm46.webp', title: '46-inch drum mulcher', keywords: '46-inch 46-inch hm46' },
  { src: '/assets/generated/product-teeth.webp', title: 'Replacement tooth', keywords: 'teeth cutter tooth replacement tooth' },
  { src: '/assets/generated/product-belt.webp', title: 'Replacement drive belt', keywords: 'belt drive-belt Replacement drive belt drive belt' },
  { src: '/assets/generated/product-brackets.webp', title: 'Weld-on tooth bracket', keywords: 'bracket welded knife holder tooth bracket' },
];

function productImage(product: Product) {
  if (product.image_url) return product.image_url;
  const details = `${product.sku} ${product.slug} ${product.name} ${product.category}`.toLowerCase();
  const exactMatch = generatedProductImages.find((image) => image.keywords.split(' ').some((keyword) => details.includes(keyword)));
  if (exactMatch) return exactMatch.src;
  const stableIndex = Array.from(product.id || product.sku || product.name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % generatedProductImages.length;
  return generatedProductImages[stableIndex].src;
}

const API = String(import.meta.env.PUBLIC_ADMIN_URL || 'http://127.0.0.1:1338').replace(/\/$/, '');
const CART_KEY = 'hongmeng_cart_v1';
const CART_NONCE_KEY = 'hongmeng_cart_nonce_v1';
const IDEMPOTENCY_KEY = 'hongmeng_order_key_v1';
const hasChinese = (value: unknown) => typeof value === 'string' && /[\u3400-\u9fff]/u.test(value);
const hasArabic = (value: unknown) => typeof value === 'string' && /[\u0600-\u06ff]/u.test(value);

/** Only absolute http(s) links are rendered, so a CMS value cannot inject javascript:. */
function socialHref(value: unknown): string {
  if (typeof value !== 'string') return '';
  const href = value.trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (/^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(href)) return `https://${href}`;
  return '';
}
const containsChineseText = (value: unknown): boolean => {
  if (hasChinese(value)) return true;
  if (Array.isArray(value)) return value.some(containsChineseText);
  if (value && typeof value === 'object') return Object.values(value).some(containsChineseText);
  return false;
};
const containsArabicText = (value: unknown): boolean => {
  if (hasArabic(value)) return true;
  if (Array.isArray(value)) return value.some(containsArabicText);
  if (value && typeof value === 'object') return Object.values(value).some(containsArabicText);
  return false;
};
function englishFallbackProduct(product: Product): Product {
  const needsEnglishCopy = [product.category, product.name, product.summary, product.description, ...(product.highlights || []), ...(product.specifications || []).flatMap((item) => [item.label, item.value]), ...(product.faqs || []).flatMap((item) => [item.question, item.answer])].some(hasChinese);
  if (!needsEnglishCopy) return product;
  return {
    ...product,
    category: hasChinese(product.category) ? 'Equipment Attachments' : product.category,
    name: hasChinese(product.name) ? (product.sku || product.slug.replaceAll('-', ' ')) : product.name,
    summary: hasChinese(product.summary) ? 'Product information is being prepared in English.' : product.summary,
    description: hasChinese(product.description) ? 'Please contact our team for product details while the English listing is being prepared.' : product.description,
    highlights: (product.highlights || []).filter((value) => !hasChinese(value)),
    specifications: (product.specifications || []).filter((item) => !hasChinese(item.label) && !hasChinese(item.value)),
    faqs: (product.faqs || []).filter((item) => !hasChinese(item.question) && !hasChinese(item.answer))
  };
}
const newOrderKey = () => {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const DEFAULT_POLICIES_BASE = {
  privacy_policy: `Hongmeng Machinery Privacy Notice\n\nLast updated: October 22, 2026\n\nThis notice explains how Hongmeng Machinery handles information when you visit this website, create an account, contact us, or place an order. Before launch, the business should replace this trading name with its exact legal entity name and add a mailing address and privacy contact method in the site administration console.\n\nInformation we collect. We may collect account details such as name, email, telephone number, password hash, and profile information; delivery and billing details you enter; order items, amounts, fulfillment and tracking records; customer support messages and chat messages; and technical information needed to protect the site and complete a transaction. We do not ask you to enter full payment card numbers on this website. Payment details are collected directly by the payment provider selected at checkout.\n\nHow we use information. We use it to operate accounts, accept and fulfill orders, provide shipping and support, prevent fraud and abuse, keep transaction records, respond to privacy requests, and meet legal obligations. Google or Facebook may share identity and profile information when you choose their sign-in buttons. A payment provider processes payment information under its own notice.\n\nCookies and local storage. Necessary browser storage supports the shopping cart, account session, cookie preference, and customer-service session. Visits are always counted anonymously: no identifier is written to your browser and the server keeps only a network-truncated IP next to a daily-salted key. Allowing analytics only decides whether we may remember this browser; rejecting it deletes any identifier already stored. If your browser sends a Global Privacy Control signal we pause the anonymous counting too. You can change this choice in Cookie Settings.\n\nSharing and sale. We disclose information to service providers only as needed to host the store, provide customer support, process payments, secure the website, or deliver orders. As currently configured, this website does not sell personal information or share it for cross-context behavioral advertising. No advertising tracker is included in the storefront. We will update this notice and the choice controls if those practices change.\n\nRetention and security. We retain account, order, and support records for as long as needed to provide services, meet accounting and legal requirements, resolve disputes, and protect the business. Passwords are stored as salted password hashes. Payment credentials are handled by payment providers. No method of storage or transmission can be guaranteed to be perfectly secure.\n\nYour choices and rights. Depending on where you live and whether the relevant law applies to this business, you may have rights to know/access, correct, delete, or obtain a copy of personal information; opt out of sale or sharing; limit certain uses of sensitive personal information; and receive equal service when exercising a right. California residents may also use an enabled Global Privacy Control signal to opt out of sale or sharing where applicable. We do not currently sell or share personal information for advertising. To make a request, use the Contact page and identify the right you wish to exercise. You do not need to create an account to submit a privacy request. We may request information needed to verify the request and authorized agent.\n\nChildren. This store is intended for adults making equipment purchases and is not directed to children under 13.\n\nChanges and contact. We will post updates on this page. Use the Contact page to reach Hongmeng Machinery about this notice. Add the legal business name, postal address, and dedicated privacy contact here before public launch.`,
  cookie_policy: `Cookie and Browser Storage Notice\n\nLast updated: October 22, 2026\n\nNecessary browser storage keeps the shopping cart, customer sign-in session, chat session, and your privacy preference working. These functions cannot be switched off in the site controls while using the related feature.\n\nOptional analytics and advertising storage is off by default. Visits are always counted anonymously: no identifier is written to your browser, and the server stores only a network-truncated IP next to a key that rotates daily. Allowing analytics only controls whether we may remember this browser — that is what keeps repeat visits and chats tied to one visitor. Rejecting it, or pressing the close button, deletes any visitor identifier already stored. If your browser sends a Global Privacy Control signal, anonymous counting is paused as well. No advertising tag is installed today. Your choice is kept for 180 days and then asked again; clearing browser storage also resets it.\n\nYou can reopen Cookie Settings from any page footer and from the Privacy Policy page. If this site later enables optional trackers, they must not load until you opt in.`,
  terms_policy: `Sales and Website Terms\n\nLast updated: October 22, 2026\n\nThese terms apply to the Hongmeng Machinery website and orders placed through it. Before launch, enter the exact seller legal entity, business mailing address, governing jurisdiction, privacy contact, and any state-specific terms in the administration console.\n\nProduct information and fit. Product descriptions, images, videos, specifications, stock, and prices are maintained by the seller. Confirm machine compatibility, dimensions, hydraulic requirements, and other fitment details with the seller before ordering if the listing does not provide them. Do not rely on a generated or illustrative image as a technical specification.\n\nPrices and payment. Prices are shown in the currency identified for the store and are rechecked by the server when an order is created. Any taxes, shipping fees, and total due must be shown before payment is authorized. Online payments are processed by the provider presented at checkout. An order is not paid until the provider confirms payment. If checkout is set to manual confirmation, the seller will contact you with payment instructions.\n\nShipping and tracking. Shipping dates are estimates unless the seller expressly confirms a date. Tracking details are added to your account after the order ships. Contact the seller through the Contact page if an order is delayed or tracking information does not update.\n\nCancellation and returns. Contact the seller promptly to cancel an order before fulfillment begins. For an item that has shipped, contact the seller before returning it so the seller can provide return authorization and destination details. Any return window, condition requirements, return freight, refund timing, or restocking fee applicable to an item must be stated by the seller before purchase and is subject to applicable law. The seller must complete those product-specific terms in the administration console before accepting consumer orders.\n\nWebsite use. Do not attempt to interfere with the website, access another customer's account, or submit false order or contact information. The seller may cancel an order and issue a refund if an item is unavailable, a listing contains a material error, or a payment cannot be authorized; the seller will contact you in that case.\n\nQuestions and disputes. Use the Contact page for order, delivery, cancellation, return, or account questions. Applicable consumer rights are not waived by these terms. The legal seller identity, governing law, and dispute contact must be completed by the seller before launch.`
};
const DEFAULT_POLICIES = {
  ...DEFAULT_POLICIES_BASE,
  shipping_policy: `Shipping Policy\n\nLast updated: October 22, 2026\n\nShipping methods, destination coverage, charges, handling times, and delivery estimates vary by item and destination. Any shipping charge shown at checkout is part of the order total. If freight delivery requires special equipment or access, the seller will confirm arrangements with you before dispatch.\n\nIn-stock items are prepared after order confirmation. Made-to-order items require a production and fulfillment estimate from the seller; contact us before ordering if you need a date commitment. Transit time begins after dispatch and is an estimate.\n\nWhen an order ships, tracking details will appear in your customer account if the carrier provides tracking. Contact Hongmeng Machinery if tracking is missing or a delivery is delayed.\n\nBefore launch, replace this template with confirmed handling times, carriers, service areas, freight, liftgate, and delivery rules.`,
  returns_policy: `Returns and Refunds Policy\n\nLast updated: October 22, 2026\n\nContact Hongmeng Machinery before returning an item. We will provide return authorization and destination instructions where a return is accepted. Do not ship an item back without written instructions.\n\nEligibility, return windows, product condition, return freight, restocking charges, cancellation limits, and refund timing depend on the product and applicable law. Any product-specific terms must be shown before purchase. If an item arrives damaged or incorrect, contact us promptly with the order number and photos of the issue.\n\nApproved refunds are issued to the original payment method when available. Processing time depends on the payment provider and financial institution.\n\nBefore launch, enter the confirmed return window, conditions, return address, return freight responsibility, cancellation process, and refund timeframes. Applicable consumer rights are not limited by this policy.`
};
const DEFAULT_POLICIES_ZH = {
  privacy_policy: `宏盟机械隐私声明\n\n最后更新：2026 年 10 月 30 日\n\n本声明说明您访问网站、注册账户、联系我们或提交订单时，宏盟机械如何处理相关信息。正式上线前，请在后台填写实际经营主体名称、邮寄地址和隐私联系渠道。\n\n我们可能收集姓名、邮箱、电话、账户资料、配送与账单地址、订单商品和金额、物流信息、客服消息，以及保障网站和交易安全所需的技术信息。我们不会要求您在本网站输入完整银行卡号；付款资料由结账时选择的支付服务商直接处理。\n\n我们使用这些信息来提供账户服务、接收和配送订单、提供客服、预防欺诈、保存交易记录、处理隐私请求并履行法律义务。您选择 Google 或 Facebook 登录时，相应服务可能向我们提供身份及个人资料。支付服务商按照其隐私声明处理付款资料。\n\n必要的浏览器存储用于购物车、账户会话、Cookie 偏好和客服会话。访问始终只做匿名计数：浏览器端不写标识，服务端只保留归并后的网段 IP 与当日盐派生的键。允许分析只决定我们能否记住这个浏览器；拒绝会删掉已写入的标识。若浏览器发送 Global Privacy Control 信号，连匿名计数也会暂停。您可在 Cookie 设置中随时更改。\n\n我们只在提供托管、客服、付款、网站安全和配送所需范围内向服务商披露信息。目前网站不出售个人信息，也不为跨情境行为广告共享个人信息。如做法变化，我们会更新本声明和选择工具。\n\n我们会在提供服务、履行会计及法律要求、解决争议和保护业务所需期间保存账户、订单和客服记录。密码以加盐哈希形式保存，支付凭据由支付服务商处理。任何存储或传输方式都无法保证绝对安全。\n\n根据您所在地及适用法律，您可能有权访问、更正、删除或获取个人信息副本，选择退出出售或共享，限制某些敏感信息用途，以及在行使权利时获得平等服务。加州居民在适用情况下还可通过已启用的 Global Privacy Control 信号选择退出出售或共享。请通过联系页面提出请求，无需注册账户；我们可能需要核实请求人或授权代理人的身份。\n\n本商城面向成年人购买设备，不以 13 岁以下儿童为目标。声明更新会发布在本页。有关隐私问题，请通过联系页面联系我们。上线前请补充实际法律主体、邮寄地址和专用隐私联系方式。`,
  cookie_policy: `Cookie 与浏览器存储说明\n\n最后更新：2026 年 10 月 30 日\n\n必要的浏览器存储用于购物车、账户登录、客服会话和隐私偏好设置。使用相关功能时，这些存储无法在网站设置中关闭。\n\n分析和广告存储默认关闭。访问始终以匿名方式计数：浏览器端不写入任何标识，服务端只保存归并后的网段 IP 与当日盐派生的键。允许分析只决定我们能否记住这个浏览器，这是把重复访问与对话计为同一人的唯一途径；拒绝（或点关闭按钮）会删除已写入的访客标识。若浏览器发送 Global Privacy Control 信号，匿名计数同样暂停。目前未安装广告跟踪代码。选择保留 180 天后重新征求；清除浏览器存储也会重置。\n\n您可以从任意页脚或本页面重新打开 Cookie 设置。如将来启用可选跟踪器，必须先取得您的同意。`,
  terms_policy: `销售与网站条款\n\n最后更新：2026 年 10 月 22 日\n\n本条款适用于宏盟机械网站及通过网站提交的订单。正式上线前，请在后台填写卖方法律主体、营业地址、适用司法辖区、隐私联系人及州级条款。\n\n商品信息、图片、视频、规格、库存和价格由卖方维护。若页面没有提供机器兼容信息，请在下单前核对设备兼容性、尺寸、液压要求及接口；技术规格应以书面确认的信息为准。\n\n价格以店铺标示的币种显示，创建订单时由服务器重新核价。任何税费、运费和应付总额均应在授权付款前展示。线上付款由结账页所示服务商处理。只有服务商确认付款后，订单才标记为已付款。如采用人工确认方式，卖方会联系您提供付款安排。\n\n配送日期为预估日期，除非卖方明确确认。商品发货后，如有物流单号，会显示在客户账户中。订单延误或物流状态未更新时，请联系卖方。\n\n如需取消尚未发货的订单，请尽快联系卖方。已发货商品退货前请联系卖方获取授权和寄回地址。退货期限、商品状况、退货运费、退款时间或补货费用须在购买前说明，并遵守适用法律。\n\n请勿干扰网站、访问他人账户或提交虚假信息。如商品缺货、页面存在重大错误或付款未获授权，卖方可取消订单并退款，同时会联系您。适用的消费者权利不因本条款而被放弃。上线前请补充真实卖方身份、适用法律及争议联系渠道。`,
  shipping_policy: `配送政策\n\n最后更新：2026 年 10 月 22 日\n\n配送方式、服务地区、费用、处理时间和预计到达时间会因商品和目的地而异。结账时显示的运费属于订单总额的一部分。如货运需要特殊设备或进场条件，卖方会在发货前与您确认安排。\n\n现货商品在订单确认后准备发货。按需生产商品的生产和交付时间须由卖方确认；如需确定日期，请在下单前联系我们。运输时间从发货后开始计算，且仅为预估。\n\n订单发货后，如承运商提供物流信息，您可在账户中查看。若物流单号缺失或配送延误，请联系宏盟机械。正式上线前，请填写已确认的处理时间、承运商、服务范围、货运、尾板及送货规则。`,
  returns_policy: `退货与退款政策\n\n最后更新：2026 年 10 月 22 日\n\n退货前请联系宏盟机械。接受退货时，我们会提供退货授权和寄回说明。未经书面说明，请勿直接寄回商品。\n\n退货资格、期限、商品状况、退货运费、补货费用、取消限制和退款时间取决于商品及适用法律。任何商品专属条款都应在购买前展示。如商品损坏或发错，请尽快提供订单号和问题照片。\n\n获批退款将在可行时退回原付款方式。到账时间取决于支付服务商和金融机构。正式上线前，请填写确认后的退货期限、商品条件、退货地址、运费承担方、取消流程和退款时限。适用消费者权利不受本政策限制。`
};
const EMPTY_STOREFRONT_COPY = {
  brand: { name: '', tagline: '', logo: '/assets/hongmeng-logo.svg' },
  announcement: { text: '', cta: '', ctaHref: '' },
  home: { eyebrow: '', title: '', subtitle: '', heroImage: '', heroVideo: '', heroMedia: ['/assets/generated/home-hero.webp', '/assets/generated/solution-forestry.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-woodland.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp'], cta: '', ctaHref: '', introEyebrow: '', introTitle: '', introDescription: '', introImage: '', introMedia: ['/assets/generated/home-intro.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp'], introCta: '', introCtaHref: '', featureEyebrow: '', featureTitle: '', featureDescription: '', featureImage: '', featureMedia: ['/assets/generated/home-feature.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-fence-line-v2.webp'], featureCta: '', featureCtaHref: '', featuredEyebrow: '', featuredTitle: '', featuredDescription: '', featuredLinkLabel: '', featuredHref: '', bottomEyebrow: '', bottomTitle: '', bottomDescription: '', bottomImage: '', bottomMedia: ['/assets/generated/home-feature.webp', '/assets/generated/solution-forestry.webp', '/assets/generated/solution-brush-clearing-v2.webp'], bottomCta: '' },
  about: { eyebrow: '', title: '', description: '', body: '', image: '', video: '', heroImage: '', heroMedia: ['/assets/generated/about-hero.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp'], contentMedia: ['/assets/generated/about-detail.webp', '/assets/generated/attachment-detail.webp', '/assets/generated/product-mulcher-detail-v2.webp'], ctaLabel: '', ctaHref: '', finalTitle: '', finalCta: '' },
  solutions: { eyebrow: '', title: '', description: '', image: '', heroMedia: ['/assets/generated/solution-forestry.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-woodland.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp'], items: undefined as Array<{ title?: string; description?: string; media?: any[]; image?: string; linkHref?: string; linkLabel?: string }>|undefined, itemOneTitle: '', itemOneDescription: '', itemOneImage: '', itemTwoTitle: '', itemTwoDescription: '', itemTwoImage: '', itemThreeTitle: '', itemThreeDescription: '', itemThreeImage: '', bottomTitle: '', bottomDescription: '', bottomCta: '' },
  shop: { eyebrow: '', title: '', description: '', emptyMessage: '' },
  contact: { title: '', description: '', sideTitle: '', sideDescription: '', image: '', media: ['/assets/generated/contact-support.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/attachment-inspection.webp'] },
  news: { eyebrow: '', title: '', description: '', storyEyebrow: '', storyTitle: '', storyDescription: '', image: '', video: '', media: ['/assets/generated/news-field.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-fence-line-v2.webp'], videoMedia: [], primaryCta: '', primaryHref: '', secondaryCta: '', secondaryHref: '' },
  footer: { description: '', quickLinksTitle: '', helpTitle: '', helpText: '', supportTitle: '', productsLabel: '', aboutLabel: '', newsLabel: '', contactLabel: '', accountLabel: '', cartLabel: '', privacyLabel: '', cookieLabel: '', termsLabel: '', shippingLabel: '', returnsLabel: '' },
  social: { tiktok: '', facebook: '', instagram: '', x: '', youtube: '', telegram: '', whatsapp: '' },
  cart: { emptyMedia: ['/assets/generated/cart-empty.webp'] },
  navigation: { homeLabel: '', aboutLabel: '', productsLabel: '', solutionsLabel: '', contactLabel: '' }
};

function sequenceFromLegacy(value: unknown, type: 'image' | 'video' = 'image') {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item: any) => typeof item === 'string' ? { url: item, type: /youtube\.com|youtu\.be|\.(mp4|webm|mov|m3u8|ogg)(?:$|[?#])/i.test(item) ? 'video' : type, muted: true, autoplay: false } : item).filter((item: any) => item?.url || item?.src);
}

function sequenceWithDefaults(value: unknown, defaults: any[], type: 'image' | 'video' = 'image') {
  const items = [...sequenceFromLegacy(value, type), ...sequenceFromLegacy(defaults, type)];
  const seen = new Set<string>();
  return items.filter((item: any) => {
    const url = String(item?.url || item?.src || '');
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function mergeStorefrontCopy(current: any, next: any) {
  const incomingSolutions = next?.solutions || {};
  const legacyItems = [1, 2, 3].map((number) => ({
    title: incomingSolutions[`item${number === 1 ? 'One' : number === 2 ? 'Two' : 'Three'}Title`] || '',
    description: incomingSolutions[`item${number === 1 ? 'One' : number === 2 ? 'Two' : 'Three'}Description`] || '',
    image: incomingSolutions[`item${number === 1 ? 'One' : number === 2 ? 'Two' : 'Three'}Image`] || ''
  })).filter((item) => item.title || item.description || item.image);
  const defaultSolutionItems = current.solutions.items || [
    { title: 'Site and vegetation maintenance', description: 'Discuss the attachment you need based on vegetation, terrain, and job frequency.', media: ['/assets/generated/home-feature.webp', '/assets/generated/solution-forestry.webp', '/assets/generated/solution-woodland.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp'] },
    { title: 'Equipment attachment selection', description: 'Share your equipment model and mounting interface so we can check installation and operating requirements.', media: ['/assets/generated/about-detail.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/attachment-inspection.webp', '/assets/generated/manufacturing-assembly-v2.webp'] },
    { title: 'Replacement parts and maintenance', description: 'Check replacement parts against your existing part number, dimensions, or photos.', media: ['/assets/generated/product-teeth.webp', '/assets/generated/attachment-detail.webp', '/assets/generated/attachment-inspection.webp', '/assets/generated/product-mulcher-detail-v2.webp'] }
  ];
  const legacySolutions = legacyItems.map((item, index) => ({ ...item, media: sequenceWithDefaults(item.image, defaultSolutionItems[index]?.media || []) }));
  const incomingSolutionsList = Array.isArray(incomingSolutions.items) ? incomingSolutions.items.map((item: any, index: number) => Array.isArray(item?.media) ? item : { ...item, media: sequenceWithDefaults(item?.image, defaultSolutionItems[index]?.media || []) }) : null;
  return {
    ...current,
    ...next,
    brand: { ...current.brand, ...next?.brand },
    home: { ...current.home, ...next?.home, heroMedia: Array.isArray(next?.home?.heroMedia) ? next.home.heroMedia : sequenceWithDefaults([next?.home?.heroVideo, next?.home?.heroImage].filter(Boolean), current.home.heroMedia), introMedia: Array.isArray(next?.home?.introMedia) ? next.home.introMedia : sequenceWithDefaults(next?.home?.introImage, current.home.introMedia), featureMedia: Array.isArray(next?.home?.featureMedia) ? next.home.featureMedia : sequenceWithDefaults(next?.home?.featureImage, current.home.featureMedia), bottomMedia: Array.isArray(next?.home?.bottomMedia) ? next.home.bottomMedia : sequenceWithDefaults(next?.home?.bottomImage, current.home.bottomMedia) },
    about: { ...current.about, ...next?.about, heroMedia: Array.isArray(next?.about?.heroMedia) ? next.about.heroMedia : sequenceWithDefaults(next?.about?.heroImage, current.about.heroMedia), contentMedia: Array.isArray(next?.about?.contentMedia) ? next.about.contentMedia : sequenceWithDefaults([next?.about?.image, next?.about?.video].filter(Boolean), current.about.contentMedia) },
    solutions: { ...current.solutions, ...incomingSolutions, heroMedia: Array.isArray(incomingSolutions.heroMedia) ? incomingSolutions.heroMedia : sequenceWithDefaults(incomingSolutions.image, current.solutions.heroMedia), items: incomingSolutionsList || (legacyItems.length ? legacySolutions : defaultSolutionItems) },
    shop: { ...current.shop, ...next?.shop },
    contact: { ...current.contact, ...next?.contact, media: Array.isArray(next?.contact?.media) ? next.contact.media : sequenceWithDefaults(next?.contact?.image, current.contact.media) },
    news: { ...current.news, ...next?.news, media: Array.isArray(next?.news?.media) ? next.news.media : sequenceWithDefaults(next?.news?.image, current.news.media), videoMedia: Array.isArray(next?.news?.videoMedia) ? next.news.videoMedia : sequenceFromLegacy(next?.news?.video ? [next.news.video] : [], 'video') },
    footer: { ...current.footer, ...next?.footer },
    social: { ...current.social, ...next?.social },
    cart: { ...current.cart, ...next?.cart, emptyMedia: Array.isArray(next?.cart?.emptyMedia) ? next.cart.emptyMedia : current.cart.emptyMedia },
    navigation: { ...current.navigation, ...next?.navigation },
    announcement: { ...current.announcement, ...next?.announcement }
  };
}

function chineseSourceCopy(current: any, source: any, key = ''): any {
  if (typeof source === 'string') {
    if (/(?:href|image|video|url|logo|src|path|tiktok|facebook|instagram|youtube|telegram|whatsapp|x)$/i.test(key) || hasChinese(source)) return source;
    return current;
  }
  if (Array.isArray(source)) return source.map((item, index) => chineseSourceCopy(current?.[index], item, key));
  if (source && typeof source === 'object') {
    return Object.fromEntries(Object.entries(source).map(([childKey, value]) => [
      childKey,
      chineseSourceCopy(current?.[childKey], value, childKey)
    ]));
  }
  return source ?? current;
}

function richTextParagraphs(value: unknown) {
  const text = String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
  return text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function readCart(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((item) => typeof item.id === 'string' && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch { return []; }
}

function Header({ count, search, setSearch, onCart, site, announcement }: { count: number; search: string; setSearch: (value: string) => void; onCart: () => void; site?: any; announcement?: { text?: string; cta?: string; ctaHref?: string } }) {
  const locale = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const nav = site?.navigation || {};
  return localizeReact(<>
    <div className="hm-top-title"><span>{site?.brandTagline || 'Attachments for Tough Jobs'}</span></div>
    <div className="hm-announcement"><Truck size={17} /><span>{announcement?.text || 'Manufacturer-direct equipment attachments · Serving U.S. customers'}</span><a href={announcement?.ctaHref || '/shop/'}>{announcement?.cta || 'Shop now'} <ArrowRight size={14} /></a></div>
    <header className="hm-header">
      <div className="hm-header-inner">
        <a className="hm-brand" href="/" aria-label={`${site?.brandName || 'Hongmeng Machinery'} Home`}>{site?.logoUrl ? <img src={site.logoUrl} alt="" className="hm-brand-logo" /> : <span className="hm-brand-mark"><span>H</span></span>}<span className="hm-brand-name">{site?.brandName || 'Hongmeng Machinery'}<small>{site?.brandTagline || 'HONGMENG MACHINERY'}</small></span></a>
      <nav className="hm-desktop-nav" aria-label="Primary navigation"><a href="/">{nav.homeLabel || 'Home'}</a><a href="/about/">{nav.aboutLabel || 'About'}</a><a href="/shop/">{nav.productsLabel || 'Shop attachments'}</a><a href="/solutions/">{nav.solutionsLabel || 'Applications'}</a><a href="/contact/">{nav.contactLabel || 'Contact'}</a></nav>
        <div className="hm-header-actions hm-header-actions-right">
          <button className="hm-mobile-menu-button" type="button" aria-label="Open navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={24} /></button>
          <button type="button" aria-label="Search products" onClick={() => setSearchOpen(!searchOpen)}><Search size={23} /></button>
          <a className="hm-contact-action" href="/contact/" aria-label="Contact"><Headphones size={23} /></a>
          <button type="button" aria-label={`Cart: ${count} items`} onClick={onCart}><ShoppingBag size={23} /><b>{count}</b></button>
          <a className="hm-account-action" href="/account/" aria-label="My account"><UserRound size={23} /></a>
        </div>
      </div>
      {menuOpen && <nav className="hm-mobile-nav" aria-label="Mobile navigation"><a href="/">{nav.homeLabel || 'Home'}</a><a href="/about/">{nav.aboutLabel || 'About'}</a><a href="/shop/">{nav.productsLabel || 'Shop attachments'}</a><a href="/solutions/">{nav.solutionsLabel || 'Applications'}</a><a href="/contact/">{nav.contactLabel || 'Contact'}</a></nav>}
      {searchOpen && <form className="hm-search" onSubmit={(event) => { event.preventDefault(); location.href = `${localePrefix(locale)}/shop/?q=${encodeURIComponent(search)}`; }}><Search size={18} /><input aria-label="Search products" placeholder="Search equipment, attachments, or parts" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus /><button type="submit">Search</button></form>}
    </header>
  </>, locale);
}

function ProductCard({ product, locale, onAdd }: { product: Product; locale: Locale; onAdd: (product: Product) => void }) {
  const money = (cents: number, currency: 'USD' | 'CNY' = 'USD') => formatMoney(cents, currency, locale);
  return localizeReact(<Card className="hm-product-card">
    <div className="hm-product-image">
      <MediaCarousel className="hm-product-card-carousel" media={[productImage(product), ...(product.gallery || [])]} title={product.name} />
      <a className="hm-product-image-link" href={`/shop/product/${encodeURIComponent(product.slug)}/`} aria-label={`View ${product.name}`} />
      <span className="hm-product-category">{product.category}</span>
    </div>
    <div className="hm-product-copy"><span className="hm-sku">{product.sku}</span><a className="hm-product-title-link" href={`/shop/product/${encodeURIComponent(product.slug)}/`}><h3>{product.name}</h3></a><p>{product.summary}</p><div className="hm-product-bottom"><strong>{money(product.price_cents, product.currency)}</strong><button className="hm-icon-button" type="button" disabled={!product.available} onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}><Plus size={21} /></button></div>{product.stock > 0 ? <small>{`${product.stock} in stock`}</small> : product.allow_backorder ? <small>Made to order</small> : <small>Out of stock</small>}</div>
  </Card>, locale);
}

function CartContents({ cart, products, locale, update, onClose, checkoutLink = false, emptyMedia }: { cart: CartLine[]; products: Product[]; locale: Locale; update: (id: string, quantity: number) => void; onClose?: () => void; checkoutLink?: boolean; emptyMedia?: StoreMedia[] }) {
  const money = (cents: number, currency: 'USD' | 'CNY' = 'USD') => formatMoney(cents, currency, locale);
  const lines = cart.map((line) => ({ ...line, product: products.find((item) => item.id === line.id) })).filter((line) => line.product) as Array<CartLine & { product: Product }>;
  const total = lines.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);
  return localizeReact(<div className="hm-cart-content">
    {lines.length === 0 ? <div className="hm-empty-cart"><MediaCarousel className="hm-empty-cart-media" media={emptyMedia} fallback={['/assets/generated/cart-empty.webp']} title="Hongmeng Machinery cart" fit="contain" /><h3>Your cart is empty</h3><p>Browse products to find an attachment for your equipment.</p><a className="hm-button hm-button-blue" href="/shop/" onClick={onClose}>Shop products</a></div> : <>
      <div className="hm-cart-lines">{lines.map(({ id, quantity, product }) => <div className="hm-cart-line" key={id}><div className="hm-cart-line-image"><img src={productImage(product)} alt="" /></div><div><strong>{product.name}</strong><small>{product.sku}</small><span>{money(product.price_cents, product.currency)}</span><div className="hm-quantity"><button type="button" aria-label="Decrease quantity" onClick={() => update(id, quantity - 1)}><Minus size={15} /></button><span>{quantity}</span><button type="button" aria-label="Increase quantity" disabled={quantity >= 99 || (!product.allow_backorder && quantity >= product.stock)} onClick={() => update(id, quantity + 1)}><Plus size={15} /></button></div></div><button className="hm-remove" type="button" onClick={() => update(id, 0)} aria-label={`Remove ${product.name}`}><X size={17} /></button></div>)}</div>
      <div className="hm-cart-summary"><div><span>Subtotal</span><strong>{money(total, lines[0]?.product.currency)}</strong></div><small>Shipping is shown before you submit your order. The final amount is confirmed at checkout.</small>{checkoutLink && <a className="hm-button hm-button-blue" href="/cart/">View cart and checkout <ArrowRight size={16} /></a>}</div>
    </>}
  </div>, locale);
}

export default function Storefront({ mode, locale = 'en', initialCopy = null, initialSettings = null, initialPolicies = null, initialDetail = null, initialProducts = null }: { mode: Mode; locale?: Locale; initialCopy?: Record<string, unknown> | null; initialSettings?: Record<string, unknown> | null; initialPolicies?: Record<string, string> | null; initialDetail?: Product | null; initialProducts?: Product[] | null }) {
  const money = (cents: number, currency: 'USD' | 'CNY' = 'USD') => formatMoney(cents, currency, locale);
  const countryLabel = (value: string) => value === 'United States' && locale === 'zh-CN' ? '美国' : value === 'United States' && locale === 'ar' ? 'الولايات المتحدة' : value;
  const countryValue = (value: string) => value === '美国' || value === 'الولايات المتحدة' ? 'United States' : value;
  const COUNTRY_ALIASES: Record<string, string> = {
    'united states': 'US', 'united states of america': 'US', usa: 'US', america: 'US',
    canada: 'CA', 'united kingdom': 'GB', uk: 'GB', australia: 'AU', 'new zealand': 'NZ',
    'united arab emirates': 'AE', uae: 'AE', 'saudi arabia': 'SA', qatar: 'QA', kuwait: 'KW',
    oman: 'OM', bahrain: 'BH', germany: 'DE', france: 'FR', italy: 'IT', spain: 'ES',
    netherlands: 'NL', poland: 'PL', sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI',
    ireland: 'IE', belgium: 'BE', austria: 'AT', switzerland: 'CH', mexico: 'MX', brazil: 'BR',
    argentina: 'AR', chile: 'CL', 'south africa': 'ZA', india: 'IN', japan: 'JP', 'south korea': 'KR',
    singapore: 'SG', malaysia: 'MY', indonesia: 'ID', philippines: 'PH', thailand: 'TH', vietnam: 'VN'
  };
  const countryCode = (value: string) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (/^[a-z]{2}$/i.test(text)) return text.toUpperCase();
    return COUNTRY_ALIASES[text] || '';
  };
  const [products, setProducts] = useState<Product[]>(initialProducts || []);
  const [loading, setLoading] = useState(!initialDetail && !initialProducts?.length);
  const [apiError, setApiError] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<Product | null>(initialDetail);
  const [search, setSearch] = useState('');
  const [refundForm, setRefundForm] = useState({ order_number: '', phone: '', reason: '' });
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundSubmitted, setRefundSubmitted] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [shippingQuote, setShippingQuote] = useState<any>(null);
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false);
  const [shippingQuoteError, setShippingQuoteError] = useState('');
  const [forgetState, setForgetState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [gateOpen, setGateOpen] = useState(false);
  const [saveForm, setSaveForm] = useState({ email: '', code: '', password: '' });
  const [saveState, setSaveState] = useState<'idle' | 'sending' | 'sent' | 'busy' | 'done' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveCooldown, setSaveCooldown] = useState(0);
  const gateAction = useRef<(() => void) | null>(null);
  const gateTrigger = useRef<HTMLElement | null>(null);
  const [category, setCategory] = useState('All');
  const [settings, setSettings] = useState(() => {
    const defaults = { shipping_mode: 'quote' as 'quote' | 'flat', shipping_cents: 0, shipping_zones: [] as Array<{ countries: string[]; mode: 'quote' | 'flat'; amount_cents: number; active: boolean }>, checkout_enabled: true, support_email: '', currency: 'USD' as 'USD' | 'CNY', payment_provider: 'manual' as PaymentProvider, payment_configured: false, payment_methods: ['manual'] as PaymentProvider[], quote_payment_methods: [] as PaymentProvider[] };
    return initialSettings ? { ...defaults, ...(initialSettings as Partial<typeof defaults>) } : defaults;
  });
  const [selectedPaymentProvider, setSelectedPaymentProvider] = useState<PaymentProvider>('manual');
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', legal_name: '', country: 'United States', province: '', city: '', line1: '', line2: '', postal_code: '', note: '' });
  const [customerSignedIn, setCustomerSignedIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<{ order_number: string; subtotal_cents: number; shipping_cents: number; tax_cents?: number; total_cents: number; shipping_status?: 'quote_pending' | 'quoted' | 'included' | 'collect'; currency: 'USD' | 'CNY'; payment_provider?: PaymentProvider } | null>(null);
  const [policies, setPolicies] = useState<Record<string, string>>({ ...(locale === 'zh-CN' ? DEFAULT_POLICIES_ZH : locale === 'ar' ? DEFAULT_POLICIES_AR : DEFAULT_POLICIES), ...(initialPolicies || {}) });
  const [storefrontCopy, setStorefrontCopy] = useState<any>(() => mergeStorefrontCopy(EMPTY_STOREFRONT_COPY, initialCopy || {}));
  const [checkoutError, setCheckoutError] = useState('');
  const [inquiryStatus, setInquiryStatus] = useState('');
  const [sendingInquiry, setSendingInquiry] = useState(false);

  useEffect(() => {
    let active = true;
    if (!cart.length) {
      setShippingQuote(null);
      setShippingQuoteLoading(false);
      setShippingQuoteError('');
      return () => { active = false; };
    }
    setShippingQuoteLoading(true);
    setShippingQuoteError('');
    fetch(`${API}/site-admin-api/shop/shipping-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: customer.country, items: cart.map((item) => ({ id: item.id, quantity: item.quantity })) })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(localizedServerMessage(locale, payload?.error?.message, 'Shipping could not be calculated.'));
        if (active) setShippingQuote(payload.data || null);
      })
      .catch((error) => {
        if (active) {
          setShippingQuote(null);
          setShippingQuoteError(error?.message || 'Shipping could not be calculated.');
        }
      })
      .finally(() => { if (active) setShippingQuoteLoading(false); });
    return () => { active = false; };
  }, [cart, customer.country, locale]);

  // 后台保存 SEO 后，运行时刷新当前静态页的 title / description / OG 标签；
  // 首屏爬虫仍读取构建时写入 HTML 的值，因此发布前仍需重新构建。
  useEffect(() => {
    if (mode === 'product') return;
    const seo = (storefrontCopy as any)?.seo?.pages?.[mode];
    if (!seo) return;
    const title = String(seo.title || '').trim();
    const description = String(seo.description || '').trim();
    const keywords = String(seo.keywords || '').trim();
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const origin = new URL(canonical?.href || window.location.href).origin;
    if (title) document.title = `${title} | Hongmeng Machinery`;
    const setMeta = (selector: string, value: string, attribute = 'content') => {
      if (!value) return;
      let element = document.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(selector.includes('property=') ? 'property' : 'name', selector.match(/["']([^"']+)["']/)?.[1] || '');
        document.head.append(element);
      }
      element.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', description);
    setMeta('meta[name="keywords"]', keywords);
    setMeta('meta[property="og:title"]', title ? `${title} | Hongmeng Machinery` : '');
    setMeta('meta[property="og:description"]', description);
    if (seo.image) setMeta('meta[property="og:image"]', new URL(seo.image, origin).href);
    setMeta('meta[name="twitter:title"]', title ? `${title} | Hongmeng Machinery` : '');
    setMeta('meta[name="twitter:description"]', description);
    if (seo.image) setMeta('meta[name="twitter:image"]', new URL(seo.image, origin).href);
  }, [storefrontCopy, mode]);

  useEffect(() => {
    trackPageview();
    const onConsent = (event: Event) => {
      // 拒绝时不发任何请求；同意后补写 visitor_id 并立刻上报首个（带标识的）pageview。
      if ((event as CustomEvent<{ analytics?: boolean }>).detail?.analytics !== true) return;
      primeVisitorId();
      trackPageview();
    };
    window.addEventListener('hongmeng:consent-updated', onConsent);
    return () => window.removeEventListener('hongmeng:consent-updated', onConsent);
  }, []);

  /** 访客自助删除：清掉本地标识与选择记录，并让服务端删掉该 visitor 的访问行。 */
  async function forgetMyData() {
    setForgetState('busy');
    let visitor = '';
    let token = '';
    try {
      visitor = window.localStorage.getItem(VISITOR_KEY) || '';
      token = window.localStorage.getItem(FORGET_TOKEN_KEY) || '';
    } catch {
      visitor = '';
    }
    try {
      if (visitor && token) {
        // 缺令牌时服务端会 403：本地照清，服务端记录等到保留期自然过期。
        await fetch(`${API}/site-admin-api/analytics/forget`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitor_id: visitor, token })
        }).catch(() => null);
      }
      try {
        window.localStorage.removeItem(FORGET_TOKEN_KEY);
      } catch {
        /* ignore */
      }
      clearOptionalIdentifiers();
      window.localStorage.removeItem(CONSENT_KEY);
      window.dispatchEvent(new CustomEvent('hongmeng:consent-updated', { detail: { analytics: false, marketing: false } }));
      window.dispatchEvent(new CustomEvent('hongmeng:open-cookie-settings'));
      setForgetState('done');
    } catch {
      setForgetState('error');
    }
  }

  useEffect(() => {
    if (saveCooldown <= 0) return;
    const timer = window.setTimeout(() => setSaveCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [saveCooldown]);

  async function sendSaveCode() {
    setSaveMessage('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(saveForm.email)) return setSaveMessage('Enter the email you used for the order first.');
    setSaveState('sending');
    try {
      const response = await fetch(`${API}/site-admin-api/customer/email-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: saveForm.email, purpose: 'claim' })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || 'Could not send the code.');
      setSaveState('sent');
      setSaveCooldown(60);
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not send the code.');
    }
  }

  async function claimOrder(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage('');
    setSaveState('busy');
    try {
      const response = await fetch(`${API}/site-admin-api/customer/claim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...saveForm, full_name: customer.name })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizedServerMessage(locale, payload.error?.message, 'Could not save this order to an account.'));
      setSaveState('done');
      setSaveMessage(`Saved — ${payload.data?.claimed_orders || 1} order(s) are now in your account. Keep this password to sign in later.`);
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not save this order to an account.');
    }
  }

  /** 没同意分析 Cookie 时，加入购物车与提交订单都要先过这道闸。 */
  function requireConsent(action: () => void) {
    if (consentState() === 'granted') { action(); return; }
    gateAction.current = action;
    gateTrigger.current = document.activeElement as HTMLElement | null;
    setGateOpen(true);
  }
  /** 同意记录里的时间就是授权时刻；用作下单的同意凭据。 */
  function consentGivenAt() {
    try {
      const record = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || 'null');
      return record?.analytics && record?.updatedAt ? record.updatedAt : '';
    } catch {
      return '';
    }
  }
  function closeGate() {
    setGateOpen(false);
    gateAction.current = null;
    gateTrigger.current?.focus?.();
  }
  async function allowAndContinue() {
    const action = gateAction.current;
    gateAction.current = null;
    setGateOpen(false);
    writeConsent({ analytics: true, marketing: false });
    // 先等埋点回应把 HttpOnly 同意 Cookie 种下来，再继续下单：这样订单走的是服务端签名凭据，不是前端时间戳。
    await ensureConsentCookie();
    action?.();
  }
  useEffect(() => {
    if (!gateOpen) return;
    document.body.classList.add('hm-gate-locked');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeGate(); return; }
      if (event.key !== 'Tab') return;
      // 焦点圈在弹窗里，Tab 不会跑到后面的表单上。
      const focusable = [...document.querySelectorAll<HTMLElement>('.hm-gate-card button, .hm-gate-card a[href]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('hm-gate-locked'); };
  }, [gateOpen]);

  useEffect(() => {
    let active = true;
    let translationPoll: number | null = null;
    setCart(readCart());
    const queryLocale = locale === 'zh-CN' ? 'zh-CN' : locale === 'ar' ? 'ar' : 'en';
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setSearch(q);
    const pathSlug = window.location.pathname.match(/^\/(?:zh\/|ar\/)?shop\/product\/([a-z0-9-]+)\/?$/)?.[1];
    const currentSlug = pathSlug || new URLSearchParams(window.location.search).get('slug');
    const localizedUrl = `${API}/site-admin-api/shop/translated-content?locale=${queryLocale}`;
    const applyTranslationSnapshot = (snapshot: any) => {
      if (!active || !snapshot?.data) return;
      const translated = snapshot.data;
      const translatedProducts = new Map((translated.products || []).map((product: Product) => [product.id, product]));
      setProducts((items) => items.map((product) => {
        const localized = translatedProducts.get(product.id) as Product | undefined;
        if (!localized) return product;
        return localizeProduct({ ...product, ...localized, image_url: product.image_url, gallery: product.gallery, videos: product.videos, price_cents: product.price_cents, currency: product.currency, stock: product.stock, allow_backorder: product.allow_backorder, available: product.available, featured: product.featured }, locale);
      }));
      setStorefrontCopy((value: any) => mergeStorefrontCopy(value, translated.storefront || {}));
      if (translated.policies) setPolicies((value) => ({ ...value, ...Object.fromEntries(Object.entries(translated.policies).filter(([, text]) => Boolean(text))) as Record<string, string> }));
      if (currentSlug) {
        const detailTranslation = (translated.products || []).find((product: Product) => product.slug === currentSlug);
        if (detailTranslation) setDetail((value) => value ? localizeProduct({ ...value, ...detailTranslation }, locale) : value);
      }
    };
    const pollTranslation = async () => {
      try {
        const response = await fetch(localizedUrl, { cache: 'no-store' });
        const result = await response.json();
        if (!active) return;
        if (result?.data && result?.meta?.status === 'ready') {
          applyTranslationSnapshot(result);
          if (translationPoll !== null) window.clearInterval(translationPoll);
          translationPoll = null;
        }
        else {
          if (!['unconfigured', 'failed'].includes(result?.meta?.status) && translationPoll === null) {
            translationPoll = window.setInterval(() => { void pollTranslation(); }, 3000);
          } else if (['unconfigured', 'failed'].includes(result?.meta?.status) && translationPoll !== null) { window.clearInterval(translationPoll); translationPoll = null; }
        }
      } catch { /* Keep the already-rendered localized copy. */ }
    };
    Promise.all([
      fetch(`${API}/site-admin-api/shop/products?locale=${queryLocale}`).then((response) => { if (!response.ok) throw new Error('catalog'); return response.json(); }),
      fetch(`${API}/site-admin-api/shop/settings`).then((response) => { if (!response.ok) throw new Error('settings'); return response.json(); }),
      fetch(`${API}/site-admin-api/shop/storefront?locale=${queryLocale}`).then((response) => response.ok ? response.json() : null).catch(() => null),
      currentSlug ? fetch(`${API}/site-admin-api/shop/products/${encodeURIComponent(currentSlug)}?locale=${queryLocale}`).then((response) => response.ok ? response.json() : null).catch(() => null) : Promise.resolve(null),
      fetch(localizedUrl, { cache: 'no-store' }).then((response) => response.json()).catch(() => null),
      fetch(`${API}/site-admin-api/shop/policies?locale=${queryLocale}`).then((response) => response.ok ? response.json() : null).catch(() => null)
    ]).then(([catalog, config, storefront, productResponse, translationSnapshot, policyResponse]) => {
      if (!active) return;
      const readySnapshot = translationSnapshot?.meta?.status === 'ready' ? translationSnapshot : null;
      const items = catalog.data || [];
      const translatedProducts = new Map((readySnapshot?.data?.products || []).map((product: Product) => [product.id, product]));
      setProducts(items.map((item: Product) => {
        const localized = translatedProducts.get(item.id) as Product | undefined;
        const merged = localized ? { ...item, ...localized, image_url: item.image_url, gallery: item.gallery, videos: item.videos, price_cents: item.price_cents, currency: item.currency, stock: item.stock, allow_backorder: item.allow_backorder, available: item.available, featured: item.featured } : item;
        return locale === 'en' ? (localized ? merged : englishFallbackProduct(item)) : localizeProduct(merged, locale);
      }));
      const sourceCopy = storefront?.data;
      const sourceCopyMatchesLocale = locale === 'zh-CN'
        ? containsChineseText(sourceCopy)
        : locale === 'ar'
          ? containsArabicText(sourceCopy)
          : !containsChineseText(sourceCopy) && !containsArabicText(sourceCopy);
      const baseCopy = readySnapshot?.data?.storefront || (sourceCopyMatchesLocale ? (locale === 'zh-CN' ? chineseSourceCopy(EMPTY_STOREFRONT_COPY, sourceCopy) : sourceCopy) : null);
      const social = [readySnapshot?.data?.storefront?.social, sourceCopy?.social]
        .find((value) => value && typeof value === 'object' && Object.values(value).some((item) => typeof item === 'string' && item.trim())) as Record<string, string> | undefined;
      const copyForPage = baseCopy ? { ...baseCopy, ...(social ? { social: { ...(baseCopy.social || {}), ...social } } : {}) } : (social ? { social } : null);
      if (copyForPage) setStorefrontCopy((value: any) => mergeStorefrontCopy(value, copyForPage));
      const sourcePolicies = policyResponse?.data;
      const sourcePolicyEntries = sourcePolicies && Object.entries(sourcePolicies).filter(([, text]) => typeof text === 'string' && text.trim() && (locale === 'en' && !hasChinese(text) && !hasArabic(text) || locale === 'zh-CN' && hasChinese(text) || locale === 'ar' && hasArabic(text)));
      if (sourcePolicyEntries?.length) {
        setPolicies((value) => ({ ...value, ...(Object.fromEntries(sourcePolicyEntries) as Record<string, string>) }));
      }
      if (readySnapshot) applyTranslationSnapshot(readySnapshot);
      else if ((locale === 'zh-CN' || locale === 'ar') && translationSnapshot?.data) applyTranslationSnapshot(translationSnapshot);
      else if (!['unconfigured', 'failed'].includes(translationSnapshot?.meta?.status)) { translationPoll = window.setInterval(() => { void pollTranslation(); }, 3000); }
      const nextSettings = config.data || { shipping_cents: 0, checkout_enabled: true, support_email: '', currency: 'USD', payment_provider: 'manual', payment_configured: false, payment_methods: ['manual'] };
      setSettings(nextSettings);
      const allowedMethods = (nextSettings.payment_methods || [nextSettings.payment_provider]).filter((value: string): value is PaymentProvider => ['manual', 'stripe', 'paypal'].includes(value));
      const selected = allowedMethods.includes(nextSettings.payment_provider) ? nextSettings.payment_provider : allowedMethods[0] || 'manual';
      setSelectedPaymentProvider(selected);
      if (currentSlug) {
        const found = productResponse?.data || items.find((item: Product) => item.slug === currentSlug);
        const localizedFound = readySnapshot?.data?.products?.find((item: Product) => item.slug === currentSlug);
        const mergedFound = localizedFound ? { ...found, ...localizedFound } : found;
        const safeFound = mergedFound ? (locale === 'en' ? (localizedFound ? mergedFound : englishFallbackProduct(mergedFound)) : localizeProduct(mergedFound, locale)) : null;
        setDetail(safeFound || null);
        if (safeFound) {
          const sourceTitle = safeFound.name || safeFound.sku;
          const titleInLocale = locale === 'ar' && !/[\u0600-\u06ff]/u.test(sourceTitle)
            ? `${safeFound.sku} ملحقات المعدات`
            : locale === 'zh-CN' && !hasChinese(sourceTitle)
              ? `${safeFound.sku} 工程机械属具`
              : sourceTitle;
          const sourceDescription = safeFound.summary || safeFound.description || sourceTitle;
          const description = locale === 'ar' && !/[\u0600-\u06ff]/u.test(sourceDescription)
            ? `تعرف على مواصفات ${safeFound.sku} وسعره وخيارات الشحن والشراء من Hongmeng Machinery.`
            : locale === 'zh-CN' && !hasChinese(sourceDescription)
              ? `查看 ${safeFound.sku} 的工程机械属具商品详情、价格、规格与配送信息。`
              : sourceDescription;
          document.title = `${titleInLocale} | Hongmeng Machinery`;
          const currentCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
          const imageOrigin = new URL(currentCanonical?.href || window.location.href).origin;
          const imageUrl = new URL(productImage(safeFound), imageOrigin).href;
          const meta = document.querySelector('meta[name="description"]');
          if (meta) meta.setAttribute('content', description);
          const setMeta = (selector: string, value: string) => {
            const element = document.querySelector<HTMLMetaElement>(selector);
            if (element) element.content = value;
          };
          const keywords = locale === 'ar'
            ? [`${safeFound.sku} ملحقات المعدات`, 'ملحقات المعدات', 'قطع غيار', 'Hongmeng Machinery']
            : locale === 'zh-CN'
              ? [`${safeFound.sku} 工程机械属具`, '工程机械属具', '替换配件', '宏盟机械']
              : [safeFound.name, safeFound.sku, safeFound.category, 'equipment attachment', 'replacement parts'];
          setMeta('meta[name="keywords"]', keywords.filter(Boolean).join(', '));
          let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
          if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
          const productPath = `/shop/product/${encodeURIComponent(safeFound.slug)}/`;
          const localizedProductPath = `${locale === 'zh-CN' ? '/zh' : locale === 'ar' ? '/ar' : ''}${productPath}`;
          const canonicalOrigin = new URL(canonical.href || window.location.href).origin;
          canonical.href = new URL(localizedProductPath, canonicalOrigin).href;
          document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]').forEach((alternate) => {
            const language = alternate.hreflang;
            const prefix = language === 'zh-CN' ? '/zh' : language === 'ar' ? '/ar' : '';
            alternate.href = new URL(`${prefix}${productPath}`, canonicalOrigin).href;
          });
          setMeta('meta[property="og:url"]', canonical.href);
          setMeta('meta[property="og:title"]', document.title);
          setMeta('meta[property="og:description"]', description);
          setMeta('meta[property="og:image"]', imageUrl);
          setMeta('meta[property="og:type"]', 'product');
          setMeta('meta[property="product:price:amount"]', (safeFound.price_cents / 100).toFixed(2));
          setMeta('meta[property="product:price:currency"]', safeFound.currency);
          setMeta('meta[name="twitter:title"]', document.title);
          setMeta('meta[name="twitter:description"]', description);
          setMeta('meta[name="twitter:image"]', imageUrl);
          const structuredData = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: titleInLocale,
            description,
            sku: safeFound.sku,
            image: [imageUrl, ...(safeFound.gallery || []).map((image: string) => new URL(image, imageOrigin).href)],
            brand: { '@type': 'Brand', name: 'Hongmeng Machinery' },
            offers: {
              '@type': 'Offer',
              url: canonical.href,
              priceCurrency: safeFound.currency,
              price: (safeFound.price_cents / 100).toFixed(2),
              availability: safeFound.stock > 0 ? 'https://schema.org/InStock' : safeFound.allow_backorder ? 'https://schema.org/BackOrder' : 'https://schema.org/OutOfStock'
            }
          };
          let jsonLd = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"][data-hongmeng-product]');
          if (!jsonLd) {
            jsonLd = document.createElement('script');
            jsonLd.type = 'application/ld+json';
            jsonLd.dataset.hongmengProduct = 'true';
            document.head.append(jsonLd);
          }
          jsonLd.textContent = JSON.stringify(structuredData).replace(/</g, '\\u003c');
        }
      }
      if (mode === 'cart') {
        fetch(`${API}/site-admin-api/customer/session`, { credentials: 'include' }).then(async (response) => {
          if (!response.ok) return null; const result = await response.json(); const user = result.data;
          if (!user) return null;
          setCustomerSignedIn(true);
          setCustomer((value) => ({ ...value, name: value.name || user.full_name, email: value.email || user.email, phone: value.phone || user.phone, legal_name: user.legal_name || '' }));
          const addressResponse = await fetch(`${API}/site-admin-api/customer/addresses`, { credentials: 'include' });
          if (!addressResponse.ok) return null;
          const addressPayload = await addressResponse.json();
          const address = (addressPayload.data || []).find((item: any) => item.is_default) || (addressPayload.data || [])[0];
          if (address) setCustomer((value) => ({ ...value, name: value.name || address.recipient, phone: value.phone || address.phone, country: address.country || value.country, province: address.region || value.province, city: value.city || address.city, line1: value.line1 || address.line1, line2: value.line2 || address.line2 || '', postal_code: value.postal_code || address.postal_code }));
          return null;
        }).catch(() => {});
      }
    })
      .catch(() => { if (active) setApiError(true); }).finally(() => { if (active) setLoading(false); });
    if (['privacy', 'cookies', 'terms', 'shipping', 'returns'].includes(mode)) {
      fetch(`${API}/site-admin-api/shop/policies?locale=${queryLocale}`).then((response) => response.json()).then((result) => {
        if (!active || (locale !== 'zh-CN' && result.meta?.status !== 'ready')) return;
        setPolicies((value) => {
          if (locale !== 'zh-CN') return { ...value, ...(result.data || {}) };
          const next = { ...value };
          for (const [key, text] of Object.entries(result.data || {})) if (hasChinese(text)) (next as any)[key] = text;
          return next;
        });
      }).catch(() => {});
    }
    return () => { active = false; if (translationPoll !== null) window.clearInterval(translationPoll); };
  }, []);

  useEffect(() => {
    const sidebarOpen = cartOpen || (Boolean(detail) && mode !== 'product');
    document.body.classList.toggle('hm-drawer-open', sidebarOpen);
    return () => document.body.classList.remove('hm-drawer-open');
  }, [cartOpen, detail, mode]);

  useEffect(() => {
    if (mode !== 'cart') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'success') return;
    const orderNumber = params.get('order') || ''; const token = params.get('token') || ''; const sessionId = params.get('session_id') || '';
    if (!orderNumber || (!token && !sessionId)) return;
    const endpoint = token ? 'paypal/capture' : 'return';
    fetch(`${API}/site-admin-api/shop/payments/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number: orderNumber, paypal_order_id: token, session_id: sessionId }) })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(localizedServerMessage(locale, payload.error?.message, 'Payment status could not be verified')); setOrder(payload.data); setCart([]); localStorage.removeItem(CART_KEY); localStorage.removeItem(IDEMPOTENCY_KEY); })
      .catch((cause) => setCheckoutError(cause instanceof Error ? cause.message : 'Payment status could not be verified'));
  }, [mode]);

  /** 购物车批次号：双击/重试保持同一批（服务端据此合并），下单成功后轮换，避免「再买一次」被吞。 */
  function cartNonce(): string {
    try {
      const existing = window.localStorage.getItem(CART_NONCE_KEY) || '';
      if (existing) return existing;
      const value = crypto.randomUUID();
      window.localStorage.setItem(CART_NONCE_KEY, value);
      return value;
    } catch {
      return '';
    }
  }
  function rotateCartNonce() {
    try {
      window.localStorage.setItem(CART_NONCE_KEY, crypto.randomUUID());
    } catch {
      /* ignore */
    }
  }

  function updateCart(id: string, quantity: number) {
    const next = cart.filter((item) => item.id !== id);
    if (quantity > 0) next.push({ id, quantity });
    setCart(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
    localStorage.removeItem(IDEMPOTENCY_KEY);
  }
  function add(product: Product) {
    addNow(product);
  }
  function addNow(product: Product) {
    const current = cart.find((item) => item.id === product.id)?.quantity || 0;
    if (current >= 99 || (!product.allow_backorder && current >= product.stock)) return;
    updateCart(product.id, current + 1);
    setCartOpen(true);
  }
  function changePaymentProvider(provider: PaymentProvider) {
    setSelectedPaymentProvider(provider);
    setCheckoutError('');
    localStorage.removeItem(IDEMPOTENCY_KEY);
  }
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const categories = ['All', ...new Set(products.map((product) => product.category))];
  const filtered = products.filter((product) => (category === 'All' || product.category === category) && (!search || `${product.name} ${product.sku} ${product.summary}`.toLowerCase().includes(search.toLowerCase())));
  const featured = products.filter((product) => product.featured).slice(0, 4);
  const homeProducts = featured.length ? featured : products.slice(0, 4);
  const cartProducts = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.id) })).filter((item) => item.product) as Array<CartLine & { product: Product }>;
  const subtotal = cartProducts.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  const shippingZone = (settings.shipping_zones || []).find((zone) => zone.active !== false && zone.countries.includes(countryCode(customer.country)));
  const fallbackShippingMode = shippingZone?.mode || settings.shipping_mode;
  const serverShippingStatus = shippingQuote?.shipping_status;
  const shippingMode = serverShippingStatus === 'quote_pending' ? 'quote' : serverShippingStatus === 'collect' ? 'collect' : serverShippingStatus === 'included' ? 'flat' : fallbackShippingMode;
  const shippingAmount = shippingQuote
    ? Number(shippingQuote.shipping_cents || 0)
    : (fallbackShippingMode === 'flat' ? Number(shippingZone?.amount_cents ?? settings.shipping_cents ?? 0) : 0);
  const total = subtotal + shippingAmount;
  const cartValid = cartProducts.length === cart.length && cartProducts.every((item) => item.product.available && (item.product.allow_backorder || item.quantity <= item.product.stock));
  const cartCurrencyValid = cartProducts.every((item) => item.product.currency === settings.currency);
  const checkoutProvider = shippingMode === 'quote' ? 'manual' : selectedPaymentProvider;
  const paymentReady = settings.payment_methods.includes(checkoutProvider) && (checkoutProvider === 'manual' || settings.currency === 'USD');
  const checkoutPaymentMethods = shippingMode === 'quote' ? ['manual'] : settings.payment_methods;
  // 按地址报价的订单同样支持游客下单，报价走邮箱回复；登录只影响能不能在账户里跟踪。
  const quoteGuestHint = shippingMode === 'quote' && !customerSignedIn;

  async function submitRefundRequest(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setRefundError('');
    if (!refundForm.order_number.trim() || !refundForm.phone.trim() || refundForm.reason.trim().length < 5) {
      setRefundError('Please enter the order number, the phone used for the order, and a reason of at least 5 characters.');
      return;
    }
    setRefundSubmitting(true);
    try {
      const response = await fetch(`${API}/site-admin-api/shop/refund-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_number: refundForm.order_number.trim(),
          phone: refundForm.phone.trim(),
          reason: refundForm.reason.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || payload?.message || 'Refund request failed.');
      setRefundSubmitted(true);
    } catch (error: any) {
      setRefundError(error?.message || 'Refund request failed.');
    } finally {
      setRefundSubmitting(false);
    }
  }

  function checkout(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitOrder();
  }

  async function submitOrder() {
    if (!cart.length || !cartValid) return setCheckoutError('Product availability changed. Please update your cart.');
    if (!cartCurrencyValid) return setCheckoutError('The cart currency does not match the store currency. Please contact us for help.');
    if (!paymentReady) return setCheckoutError('The selected payment method is not ready. Refresh the page or contact support.');
    setCheckoutError('');
    // 等到确实能提交了才问同意：避免先允许了却因为别的原因提交不出去。
    if (consentState() !== 'granted') {
      requireConsent(() => { void submitOrder(); });
      return;
    }
    setSubmitting(true);
    try {
      let key = localStorage.getItem(IDEMPOTENCY_KEY);
      if (!key) { key = newOrderKey(); localStorage.setItem(IDEMPOTENCY_KEY, key); }
      const response = await fetch(`${API}/site-admin-api/shop/orders`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer, shipping_address: customer, note: customer.note, items: cart, payment_provider: checkoutProvider, idempotency_key: key, expected_total_cents: total, consent_analytics_at: consentGivenAt(), cart_nonce: cartNonce() }) });
      const payload = await response.json();
      if (response.status === 428) {
        setSubmitting(false);
        setCheckoutError('');
        requireConsent(() => { void submitOrder(); });
        return;
      }
      if (!response.ok) throw new Error(localizedServerMessage(locale, payload.error?.message, 'Order could not be submitted'));
      if (payload.data.checkout_url) { location.assign(payload.data.checkout_url); return; }
      setSaveForm((value) => ({ ...value, email: customer.email }));
      setSaveState('idle');
      rotateCartNonce();
      setOrder(payload.data); setCart([]); localStorage.removeItem(CART_KEY); localStorage.removeItem(IDEMPOTENCY_KEY);
    } catch (error) { setCheckoutError(error instanceof Error ? error.message : 'Order could not be submitted'); }
    finally { setSubmitting(false); }
  }

  async function submitInquiry(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (String(fields.get('website') || '').trim()) return;
    setSendingInquiry(true); setInquiryStatus('');
    try {
      const response = await fetch(`${API}/site-admin-api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fields.get('name'), companyName: fields.get('company'), phone: fields.get('phone'), email: fields.get('email'), message: fields.get('message'), sourcePage: `${localePrefix(locale)}/contact/`, sourceUrl: window.location.href })
      });
      if (!response.ok) throw new Error(localizedServerMessage(locale, (await response.json()).error?.message, 'Submission failed. Please try again later.'));
      form.reset(); setInquiryStatus('Your message has been sent. We will reply using the contact details you provided.');
    } catch (error) { setInquiryStatus(error instanceof Error ? error.message : 'Submission failed. Please try again later.'); }
    finally { setSendingInquiry(false); }
  }

  const pageCopy = storefrontCopy;
  const site = {
    brandName: pageCopy.brand?.name || 'Hongmeng Machinery',
    brandTagline: pageCopy.brand?.tagline || 'HONGMENG MACHINERY',
    logoUrl: pageCopy.brand?.logo || '/assets/hongmeng-logo.svg',
    navigation: pageCopy.navigation,
    footer: { description: pageCopy.footer?.description, quickLinksTitle: pageCopy.footer?.quickLinksTitle, supportTitle: pageCopy.footer?.supportTitle || pageCopy.footer?.helpTitle }
  };
  const homeCopy: any = {
    hero: { eyebrow: pageCopy.home?.eyebrow, title: pageCopy.home?.title, subtitle: pageCopy.home?.subtitle, backgroundImage: pageCopy.home?.heroImage, backgroundVideo: pageCopy.home?.heroVideo, primaryCta: pageCopy.home?.cta, primaryHref: pageCopy.home?.ctaHref },
    productIntro: { eyebrow: pageCopy.home?.introEyebrow, title: pageCopy.home?.introTitle, description: pageCopy.home?.introDescription, image: pageCopy.home?.introImage, ctaLabel: pageCopy.home?.introCta, ctaHref: pageCopy.home?.introCtaHref },
    advantagesIntro: { eyebrow: pageCopy.home?.featureEyebrow, title: pageCopy.home?.featureTitle, description: pageCopy.home?.featureDescription, image: pageCopy.home?.featureImage, ctaLabel: pageCopy.home?.featureCta, ctaHref: pageCopy.home?.featureCtaHref },
    cta: { title: pageCopy.home?.bottomTitle, description: pageCopy.home?.bottomDescription, bottomImage: pageCopy.home?.bottomImage, primaryLabel: pageCopy.home?.bottomCta, primaryHref: pageCopy.home?.bottomCtaHref },
    featuredProducts: { title: pageCopy.home?.featuredTitle, description: pageCopy.home?.featuredDescription, linkLabel: pageCopy.home?.featuredLinkLabel },
    advantages: pageCopy.home?.benefits || pageCopy.home?.advantages
  };
  const socialLinks = (Object.entries(SOCIAL_PLATFORM_LABELS) as Array<[SocialPlatform, string]>)
    .map(([platform, label]) => ({ platform, label, href: socialHref(pageCopy.social?.[platform]) }))
    .filter((item) => item.href);
  return <LocaleProvider locale={locale}>{localizeReact(<div className={`hm-storefront hm-mode-${mode}`}>
    <Header count={count} search={search} setSearch={setSearch} onCart={() => setCartOpen(true)} site={site} announcement={pageCopy.announcement} />
    <main>
      {mode === 'home' && <>
        <section className="hm-hero"><MediaCarousel className="hm-hero-carousel" media={pageCopy.home?.heroMedia} fallback={['/assets/generated/home-hero.webp', '/assets/generated/solution-forestry.webp', '/assets/generated/solution-land-clearing.webp']} title={homeCopy.hero?.title || 'Hongmeng Machinery equipment attachments'} /><div className="hm-hero-shade" /><div className="hm-hero-content"><span className="hm-eyebrow">{homeCopy.hero?.eyebrow || 'HONGMENG MACHINERY / EQUIPMENT ATTACHMENTS'}</span><h1>{homeCopy.hero?.title || 'Equipment built to take on tougher work.'}</h1><p>{homeCopy.hero?.subtitle || 'Attachments designed for real job conditions. Browse the shop to find the right tool for your next task.'}</p><a href={homeCopy.hero?.primaryHref || '/shop/'} className="hm-button hm-button-white">{homeCopy.hero?.primaryCta || 'Shop attachments'} <ArrowRight size={18} /></a></div><span className="hm-hero-index">01 / HONGMENG</span></section>
        <section className="hm-benefits">{(homeCopy.advantages?.length ? homeCopy.advantages : [{ title: 'Fulfillment options', description: 'Confirm delivery details for your equipment and location.' }, { title: 'Product information', description: 'Choose attachments for your operating conditions.' }, { title: 'Clear product details', description: 'Review product information and store policies before ordering.' }, { title: 'Product support', description: 'Ask questions before or after your purchase.' }]).slice(0, 4).map((benefit: any, index: number) => <div key={`${benefit.title}-${index}`}>{index % 2 ? <PackageCheck /> : <ShieldCheck />}<span><strong>{benefit.title}</strong><small>{benefit.description}</small></span></div>)}</section>
        <section className="hm-intro hm-section"><div className="hm-intro-copy"><span className="hm-eyebrow">{homeCopy.productIntro?.eyebrow || 'WELCOME TO HONGMENG'}</span><h2>{homeCopy.productIntro?.title || 'Choose attachments for the work you actually do.'}</h2><p>{homeCopy.productIntro?.description || 'Choose attachments based on your equipment, job, and site conditions. Product information and availability are maintained by our team. Contact us if you need help confirming fitment.'}</p><a href={homeCopy.productIntro?.ctaHref || '/about/'} className="hm-text-link">{homeCopy.productIntro?.ctaLabel || 'About Hongmeng Machinery'} <ArrowRight size={17} /></a></div><div className="hm-intro-visual"><MediaCarousel media={pageCopy.home?.introMedia} fallback={['/assets/generated/home-intro.webp', '/assets/generated/about-detail.webp']} title="Hongmeng Machinery equipment in use" /></div></section>
        <section className="hm-feature hm-section"><div><span className="hm-eyebrow">{homeCopy.advantagesIntro?.eyebrow || 'BUILT FOR THE FIELD'}</span><h2>{homeCopy.advantagesIntro?.title || 'Move brush-clearing work forward.'}</h2><p>{homeCopy.advantagesIntro?.description || 'From brush clearing to site maintenance, the right attachment can help reduce repeat work and equipment downtime. We focus on practical performance and ongoing service.'}</p><a className="hm-button hm-button-blue" href={homeCopy.advantagesIntro?.ctaHref || '/shop/'}>{homeCopy.advantagesIntro?.ctaLabel || 'Explore products'} <ArrowRight size={17} /></a></div><div className="hm-feature-image"><MediaCarousel media={pageCopy.home?.featureMedia} fallback={['/assets/generated/home-feature.webp', '/assets/generated/solution-land-clearing.webp']} title="Hongmeng Machinery equipment in use" /></div></section>
        <section className="hm-shop-preview hm-section"><div className="hm-section-heading"><div><span className="hm-eyebrow">{pageCopy.home?.featuredEyebrow || 'THE COLLECTION'}</span><h2>{homeCopy.featuredProducts?.title || 'Featured products'}</h2><p>{homeCopy.featuredProducts?.description}</p></div><a className="hm-text-link" href={pageCopy.home?.featuredHref || '/shop/'}>{homeCopy.featuredProducts?.linkLabel || 'View all products'} <ArrowRight size={17} /></a></div>{loading ? <p className="hm-state">Loading products…</p> : apiError && !products.length ? <p className="hm-state">Products are temporarily unavailable. Please refresh the page.</p> : homeProducts.length ? <div className="hm-product-grid">{homeProducts.map((product) => <ProductCard key={product.id} product={product} locale={locale} onAdd={add} />)}</div> : <p className="hm-state">{pageCopy.shop?.emptyMessage || 'Products are being prepared. Please check back soon.'}</p>}</section>
        <section className="hm-final-cta"><MediaCarousel className="hm-final-carousel" media={pageCopy.home?.bottomMedia} fallback={[homeCopy.cta?.bottomImage, '/assets/generated/home-feature.webp'].filter(Boolean)} title="Hongmeng Machinery field work" /><span className="hm-eyebrow">{pageCopy.home?.bottomEyebrow || 'READY FOR THE NEXT JOB?'}</span><h2>{homeCopy.cta?.title || 'Find the right attachment for your next job.'}</h2><p>{homeCopy.cta?.description || 'Browse products or contact us to discuss fitment and selection.'}</p><a className="hm-button hm-button-white" href={homeCopy.cta?.primaryHref || '/contact/'}>{homeCopy.cta?.primaryLabel || 'Contact us'} <ArrowRight size={17} /></a></section>
      </>}
      {mode === 'shop' && <section className="hm-shop-page hm-section"><div className="hm-page-heading"><span className="hm-eyebrow">{pageCopy.shop?.eyebrow || 'SHOP / HONGMENG MACHINERY'}</span><h1>{pageCopy.shop?.title || 'Shop attachments'}</h1><p>{pageCopy.shop?.description || 'Filter products by category. Prices and availability are managed by Hongmeng Machinery.'}</p></div><div className="hm-shop-toolbar"><div className="hm-categories">{categories.map((value) => <button key={value} className={value === category ? 'active' : ''} type="button" onClick={() => setCategory(value)}>{value}</button>)}</div><label className="hm-filter-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU" /></label></div>{loading ? <p className="hm-state">Loading products…</p> : apiError && !products.length ? <p className="hm-state">Products are temporarily unavailable. Please refresh the page.</p> : filtered.length ? <div className="hm-product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} locale={locale} onAdd={add} />)}</div> : category === 'All' && !search ? <div className="hm-state"><p>{pageCopy.shop?.emptyMessage || 'There are no products available right now.'}</p><a className="hm-button hm-button-blue" href="/contact/">Ask about a product <ArrowRight size={17} /></a></div> : <div className="hm-state">No products match your search.</div>}</section>}
      {mode === 'product' && <section className="hm-product-page hm-section">{loading ? <p className="hm-state">Loading product details…</p> : !detail ? <div className="hm-state"><div><h1>Product not found</h1><p>This product may be unpublished or the link may be incorrect.</p><a href="/shop/" className="hm-button hm-button-blue">Back to the shop</a></div></div> : <><nav className="hm-breadcrumb"><a href="/">Home</a><span>/</span><a href="/shop/">Shop</a><span>/</span><span>{detail.name}</span></nav><div className="hm-product-detail-grid"><div className="hm-product-media"><MediaCarousel className="hm-product-gallery-carousel" fit="contain" media={[productImage(detail), ...(detail.gallery || []), ...(detail.videos || []).map((entry) => typeof entry === 'string' ? ({ url: entry, type: 'video' as const, autoplay: false, muted: true }) : entry)]} title={detail.name} /></div><article className="hm-product-detail-copy"><span className="hm-eyebrow">{detail.category} / SKU {detail.sku}</span><h1>{detail.name}</h1><p className="hm-product-lead">{detail.summary}</p><strong className="hm-product-price">{money(detail.price_cents, detail.currency)}</strong><p className="hm-stock-note">{detail.stock > 0 ? `${detail.stock} in stock` : detail.allow_backorder ? 'Made to order' : 'Out of stock'}</p><button className="hm-button hm-button-blue" type="button" disabled={!detail.available} onClick={() => add(detail)}>Add to cart <ShoppingBag size={18} /></button><p className="hm-product-shipping-note">{settings.shipping_mode === 'quote' ? 'Shipping is quoted after we receive your delivery address. We will confirm the shipping charge and final total before payment.' : `Shipping is ${money(settings.shipping_cents, settings.currency)}. Your final total is shown at checkout.`}</p>{detail.highlights?.length > 0 && <section className="hm-product-highlights"><h2>Highlights</h2><ul>{detail.highlights.map((item) => <li key={item}>{item}</li>)}</ul></section>}<div className="hm-product-description"><h2>Product details</h2><p>{detail.description}</p></div>{detail.specifications?.length > 0 && <section className="hm-product-specs"><h2>Specifications</h2><dl>{detail.specifications.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section>}{detail.faqs?.length > 0 && <section className="hm-product-faq"><h2>Frequently asked questions</h2>{detail.faqs.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>}<div className="hm-product-detail-links"><a href="/privacy/">Privacy policy</a><a href="/shipping/">Shipping</a><a href="/returns/">Returns</a><a href="/terms/">Sales terms</a><a href="/contact/">Ask about fitment</a></div></article></div></>}</section>}
      {mode === 'cart' && <section className="hm-checkout-page hm-section"><div className="hm-page-heading"><span className="hm-eyebrow">CHECKOUT / HONGMENG MACHINERY</span><h1>Cart and checkout</h1><p>Review your items and shipping information. Product prices and shipping are verified when you submit your order.</p></div>{order ? <div className="hm-order-success"><Check size={44} /><h2>{order.shipping_status === 'quote_pending' ? 'Order request received' : 'Order placed'}</h2><p>Order number: <strong>{order.order_number}</strong></p>{order.shipping_status === 'quote_pending' ? <><p>Product subtotal: {money(order.subtotal_cents, order.currency)}</p><p>Shipping: Pending confirmation</p><p>We received your order request. Our team will confirm shipping and the final amount before payment.</p></> : <><p>Order total: {money(order.total_cents, order.currency)}</p>{order.shipping_status === 'collect' && <p>Freight is collect on delivery.</p>}</>}{Number(order.tax_cents || 0) > 0 && <p>Tax: {money(Number(order.tax_cents), order.currency)}</p>}<p>{(order.payment_provider || selectedPaymentProvider) === 'manual' ? 'Our team will follow up using your contact details.' : 'Payment status is confirmed by the payment provider. You can review the order in your account.'}</p><a href="/account/" className="hm-button hm-button-blue">View my orders</a>{!customerSignedIn && (saveState === 'done' ? <div className="hm-save-account hm-save-account-done" role="status"><Check size={20} /><div><strong>Order saved to your account</strong><p>{saveMessage}</p><a href="/account/login/">Sign in and track it</a></div></div> : <form className="hm-save-account" onSubmit={claimOrder}><strong>Save this order to an account</strong><p>Use the email you ordered with. We send a 6-digit code to confirm it is yours; then the order shows up in your account.</p><label>Email<input required type="email" autoComplete="email" value={saveForm.email} onChange={(event) => setSaveForm({ ...saveForm, email: event.target.value })} /></label><label>Verification code<span className="hm-code-row"><input required inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={saveForm.code} onChange={(event) => setSaveForm({ ...saveForm, code: event.target.value.replace(/\D/g, '') })} /><button type="button" className="hm-code-send" onClick={sendSaveCode} disabled={saveState === 'sending' || saveCooldown > 0}>{saveCooldown > 0 ? `Resend in ${saveCooldown}s` : saveState === 'sending' ? 'Sending…' : 'Send code'}</button></span>{saveState === 'sent' && <small className="hm-code-hint">Code sent, valid 10 minutes.</small>}</label><label>Password (at least 12 characters)<input required type="password" minLength={12} autoComplete="new-password" value={saveForm.password} onChange={(event) => setSaveForm({ ...saveForm, password: event.target.value })} /></label>{saveMessage && saveState === 'error' && <p className="hm-error" role="alert">{saveMessage}</p>}<button className="hm-button hm-button-blue" type="submit" disabled={saveState === 'busy'}>{saveState === 'busy' ? 'Saving…' : 'Create account and save order'}</button></form>)}</div> : <div className="hm-checkout-grid"><div><h2>Items</h2><CartContents cart={cart} products={products} locale={locale} update={updateCart} emptyMedia={pageCopy.cart?.emptyMedia} />{cart.length > 0 && !cartValid && <p className="hm-error">A product is unavailable or the requested quantity exceeds available stock. Update your cart.</p>}{cart.length > 0 && !cartCurrencyValid && <p className="hm-error">The cart currency does not match the store currency. You cannot submit the order yet.</p>}</div><div className="hm-checkout-panel"><h2>Shipping information</h2><form onSubmit={checkout}><div className="hm-form-row"><label>Recipient *<input required maxLength={120} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label><label>Phone *<input required maxLength={60} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></label></div><label>Email *<input required type="email" maxLength={180} value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></label><label>Legal name (optional)<input maxLength={120} value={customer.legal_name} onChange={(e) => setCustomer({ ...customer, legal_name: e.target.value })} /></label><div className="hm-form-row"><label>State / region<input maxLength={100} value={customer.province} onChange={(e) => setCustomer({ ...customer, province: e.target.value })} /></label><label>City *<input required maxLength={100} value={customer.city} onChange={(e) => setCustomer({ ...customer, city: e.target.value })} /></label></div><label>Street address *<input required maxLength={300} value={customer.line1} onChange={(e) => setCustomer({ ...customer, line1: e.target.value })} /></label><label>Address line 2<input maxLength={300} value={customer.line2} onChange={(e) => setCustomer({ ...customer, line2: e.target.value })} /></label><div className="hm-form-row"><label>Country<input maxLength={80} value={countryLabel(customer.country)} onChange={(e) => setCustomer({ ...customer, country: countryValue(e.target.value) })} /></label><label>ZIP code<input maxLength={30} value={customer.postal_code} onChange={(e) => setCustomer({ ...customer, postal_code: e.target.value })} /></label></div><label>Order notes<textarea maxLength={1000} rows={3} value={customer.note} onChange={(e) => setCustomer({ ...customer, note: e.target.value })} /></label>{checkoutPaymentMethods.length > 1 && <label>Payment method<select value={selectedPaymentProvider} onChange={(event) => changePaymentProvider(event.target.value as PaymentProvider)}>{checkoutPaymentMethods.map((provider) => <option key={provider} value={provider}>{provider === 'manual' ? 'Manual payment confirmation' : provider === 'stripe' ? 'Credit or debit card (Stripe)' : 'PayPal'}</option>)}</select></label>}<div className="hm-order-totals"><div><span>Subtotal</span><strong>{money(subtotal, settings.currency)}</strong></div>{shippingMode === 'quote' ? <><div><span>Shipping</span><strong>Quoted after order request</strong></div><p className="hm-muted">We will confirm shipping and the final total with you before payment.</p></> : shippingMode === 'collect' ? <><div><span>Shipping</span><strong>Freight collect</strong></div>{shippingAmount > 0 && <div><span>Fixed shipping</span><strong>{money(shippingAmount, settings.currency)}</strong></div>}<div><strong>Order total</strong><strong>{money(total, settings.currency)}</strong></div><p className="hm-muted">Freight is paid to the carrier on delivery; only the product and any fixed shipping amount are charged now.</p></> : <><div><span>Shipping</span><strong>{money(shippingAmount, settings.currency)}</strong></div><div><strong>Order total</strong><strong>{money(total, settings.currency)}</strong></div></>}{shippingQuoteLoading && <p className="hm-muted">Calculating shipping…</p>}{shippingQuoteError && <p className="hm-error" role="alert">{shippingQuoteError}</p>}</div>{quoteGuestHint && <p className="hm-muted">You can order as a guest — we reply with the shipping quote by email. <a href="/account/login/">Sign in</a> or <a href="/account/register/">create an account</a> if you would rather track the quote and later orders in one place.</p>}{checkoutError && <p role="alert" className="hm-error">{checkoutError}</p>}{!paymentReady && <p className="hm-error">The selected payment method is not ready. Please contact support.</p>}<button className="hm-button hm-button-blue hm-submit" type="submit" disabled={!cart.length || !cartValid || !cartCurrencyValid || !settings.checkout_enabled || !paymentReady || !shippingQuote || shippingQuoteLoading || Boolean(shippingQuoteError) || submitting}>{submitting ? 'Processing…' : shippingMode === 'quote' ? 'Request order and shipping quote' : checkoutProvider === 'manual' ? 'Place order' : 'Continue to secure payment'} <ArrowRight size={17} /></button><small>{shippingMode === 'quote' ? 'This submits an order request only. We will confirm shipping and the final total before arranging payment.' : checkoutProvider === 'manual' ? 'Payment is confirmed manually by our team.' : paymentReady ? (checkoutProvider === 'stripe' ? 'Payment will be securely processed by Stripe; applicable sales tax is calculated from your billing address at checkout.' : `Payment will be securely processed by ${checkoutProvider}.`) : 'Online payment has not been configured. Contact us to place an order.'} By continuing, you agree to the <a href="/terms/">Sales terms</a>.</small></form></div></div>}</section>}
      {mode === 'about' && <>
        <section className="hm-inner-hero"><MediaCarousel className="hm-inner-hero-carousel" media={pageCopy.about?.heroMedia} title={pageCopy.about?.title || 'About Hongmeng Machinery'} /><div className="hm-hero-shade" /><div><span className="hm-eyebrow">{pageCopy.about?.eyebrow || 'ABOUT HONGMENG'}</span><h1>{pageCopy.about?.title || 'Find the right tool for every job.'}</h1><p>{pageCopy.about?.description || 'Equipment attachments and replacement parts by Hongmeng Machinery.'}</p></div></section>
        <section className="hm-intro hm-section"><div className="hm-intro-copy"><span className="hm-eyebrow">OUR APPROACH</span><h2>{pageCopy.about?.title || 'Choose based on your equipment and job.'}</h2><div className="hm-rich-copy">{richTextParagraphs(pageCopy.about?.body || 'Different equipment and job conditions call for different attachments. Browse available products, pricing, and ordering options. Confirm compatibility and fulfillment details before you order.').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><a href={pageCopy.about?.ctaHref || '/contact/'} className="hm-text-link">{pageCopy.about?.ctaLabel || 'Ask about fitment'} <ArrowRight size={17} /></a></div><div className="hm-intro-visual"><MediaCarousel media={pageCopy.about?.contentMedia} title="Hongmeng Machinery attachment manufacturing and details" /></div></section>
        <section className="hm-final-cta"><span className="hm-eyebrow">EXPLORE THE COLLECTION</span><h2>{pageCopy.about?.finalTitle || 'See which attachments fit your work.'}</h2><a className="hm-button hm-button-white" href={pageCopy.about?.finalCtaHref || '/shop/'}>{pageCopy.about?.finalCta || 'Shop products'} <ArrowRight size={17} /></a></section>
      </>}
      {mode === 'solutions' && <section className="hm-section hm-solutions-page">
        <div className="hm-page-heading"><span className="hm-eyebrow">{pageCopy.solutions?.eyebrow || 'SOLUTIONS / HONGMENG MACHINERY'}</span><h1>{pageCopy.solutions?.title || 'Choose an attachment for your job site'}</h1><p>{pageCopy.solutions?.description || 'Start with your equipment and site conditions, then review attachment specifications, fitment, and fulfillment details.'}</p></div>
        <MediaCarousel className="hm-solutions-hero-image" media={pageCopy.solutions?.heroMedia} title={pageCopy.solutions?.title || 'Hongmeng Machinery applications'} />
        <div className="hm-solution-grid">{(pageCopy.solutions?.items || []).map((item: any, index: number) => <article className="hm-solution-card" key={`${item.title || 'solution'}-${index}`}>
          <MediaCarousel className="hm-solution-card-media" media={Array.isArray(item.media) ? item.media : item.image ? [item.image] : undefined} fallback={index === 0 ? ['/assets/generated/home-feature.webp', '/assets/generated/solution-forestry.webp'] : index === 1 ? ['/assets/generated/about-detail.webp', '/assets/generated/manufacturing-workshop.webp'] : ['/assets/generated/product-teeth.webp', '/assets/generated/attachment-detail.webp']} title={item.title || 'Hongmeng Machinery application'} />
          <div className="hm-solution-card-copy">{item.eyebrow && <span className="hm-eyebrow">{item.eyebrow}</span>}<h2>{item.title || 'Application solution'}</h2><p>{item.description}</p><a className="hm-text-link" href={item.linkHref || '/contact/'}>{item.linkLabel || 'Ask about applications'} <ArrowRight size={16} /></a></div>
        </article>)}</div>
        <section className="hm-final-cta"><span className="hm-eyebrow">MATCH YOUR EQUIPMENT</span><h2>{pageCopy.solutions?.bottomTitle || 'Not sure if an attachment will fit?'}</h2><p>{pageCopy.solutions?.bottomDescription || 'Send us your equipment model, mounting interface, and job requirements. We can help review product information.'}</p><a className="hm-button hm-button-white" href={pageCopy.solutions?.bottomHref || '/contact/'}>{pageCopy.solutions?.bottomCta || 'Contact product support'} <ArrowRight size={17} /></a></section>
      </section>}
      {mode === 'contact' && <section className="hm-section hm-contact-page"><div className="hm-page-heading"><span className="hm-eyebrow">CONTACT HONGMENG</span><h1>{pageCopy.contact?.title || 'Contact'}</h1><p>{pageCopy.contact?.description || 'Tell us your equipment model, job requirements, or purchasing question. Our team will get back to you.'}</p></div><div className="hm-contact-grid"><div className="hm-contact-aside"><MediaCarousel className="hm-contact-media" media={pageCopy.contact?.media} title="Hongmeng Machinery product support" /><div><Headphones size={36} /><h2>{pageCopy.contact?.sideTitle || 'Confirm the fit before choosing an attachment.'}</h2><p>{pageCopy.contact?.sideDescription || 'Ask us about compatibility, product details, availability, or delivery.'}</p>{settings.support_email && <a href={`mailto:${settings.support_email}`}>{settings.support_email}</a>}</div></div><form className="hm-contact-form" onSubmit={submitInquiry}><input name="website" className="hm-honeypot" tabIndex={-1} autoComplete="off" /><div className="hm-form-row"><label>Name *<input name="name" required maxLength={120} /></label><label>Company name<input name="company" maxLength={160} /></label></div><div className="hm-form-row"><label>Phone<input name="phone" maxLength={32} /></label><label>Email<input name="email" type="email" maxLength={254} /></label></div><label>How can we help? *<textarea name="message" required maxLength={5000} rows={7} placeholder="For example: equipment model, job conditions, or the attachment or part you need" /></label><small>Please provide at least a phone number or email address.</small>{inquiryStatus && <p role="status" className="hm-inquiry-status">{inquiryStatus}</p>}<button className="hm-button hm-button-blue" type="submit" disabled={sendingInquiry}>{sendingInquiry ? 'Submitting…' : 'Send message'} <ArrowRight size={17} /></button></form></div></section>}
      {mode === 'news' && <section className="hm-section hm-news-page"><div className="hm-page-heading"><span className="hm-eyebrow">{pageCopy.news?.eyebrow || 'NEWS / HONGMENG MACHINERY'}</span><h1>{pageCopy.news?.title || 'News and updates'}</h1><p>{pageCopy.news?.description || 'Product updates and application notes will be posted here.'}</p></div><div className="hm-news-feature"><MediaCarousel className="hm-news-media" media={pageCopy.news?.media} title="Hongmeng Machinery equipment in use" /><div><span className="hm-eyebrow">{pageCopy.news?.storyEyebrow || 'FIELD NOTES'}</span><h2>{pageCopy.news?.storyTitle || 'Attachments for real work sites'}</h2><p>{pageCopy.news?.storyDescription || 'Explore Hongmeng Machinery products and contact us about fitment, applications, or purchasing.'}</p>{pageCopy.news?.videoMedia?.length ? <MediaCarousel media={pageCopy.news.videoMedia} title="Hongmeng Machinery product video" className="hm-news-inline-video" /> : pageCopy.news?.video && <MediaCarousel media={[{ url: pageCopy.news.video, type: 'video', autoplay: false, muted: true }]} title="Hongmeng Machinery product video" className="hm-news-inline-video" />}<a className="hm-text-link" href={pageCopy.news?.primaryHref || '/contact/'}>{pageCopy.news?.primaryCta || 'Ask about an application'} <ArrowRight size={17} /></a></div></div><div className="hm-news-actions"><a className="hm-button hm-button-blue" href={pageCopy.news?.secondaryHref || '/shop/'}>{pageCopy.news?.secondaryCta || 'Shop products'} <ArrowRight size={17} /></a><a className="hm-text-link" href="/contact/">Contact <ArrowRight size={17} /></a></div></section>}
      {mode === 'not-found' && <section className="hm-section hm-news-page"><div className="hm-page-heading"><span className="hm-eyebrow">404 / PAGE NOT FOUND</span><h1>Page not found</h1><p>The page you requested does not exist or has moved.</p></div><a className="hm-button hm-button-blue" href="/">Return home <ArrowRight size={17} /></a></section>}
    {['privacy', 'cookies', 'terms', 'shipping', 'returns'].includes(mode) && <section className="hm-legal-page hm-section"><div className="hm-page-heading"><span className="hm-eyebrow">HONGMENG MACHINERY / LEGAL</span><h1>{({ privacy: 'Privacy Policy', cookies: 'Cookie Policy', terms: 'Sales Terms', shipping: 'Shipping Policy', returns: 'Returns and Refunds' } as Record<string, string>)[mode]}</h1><p>Last updated: October 22, 2026</p></div><article className="hm-legal-copy"><pre>{mode === 'privacy' ? policies.privacy_policy : mode === 'cookies' ? policies.cookie_policy : mode === 'terms' ? policies.terms_policy : mode === 'shipping' ? policies.shipping_policy : policies.returns_policy}</pre>{mode === 'privacy' && <div id="privacy-choices" className="hm-privacy-choice-card"><div className="hm-privacy-choice-content"><span className="hm-eyebrow">YOUR CONTROL</span><h2>Manage privacy choices</h2><p>Choose whether we may remember this browser, or delete what is already stored.</p><p className="hm-privacy-choice-note">To make a privacy request or ask about order information, contact us. You do not need an account.</p><a href="/contact/">Contact Hongmeng Machinery</a></div><div className="hm-privacy-choice-actions"><button className="hm-button hm-button-blue hm-privacy-choice-action" type="button" onClick={() => window.dispatchEvent(new CustomEvent('hongmeng:open-cookie-settings'))}>Cookie settings</button><button className="hm-button hm-privacy-choice-action hm-privacy-choice-delete" type="button" onClick={forgetMyData} disabled={forgetState === 'busy'}>{forgetState === 'busy' ? 'Deleting…' : 'Delete stored data'}</button>{forgetState === 'done' && <p className="hm-privacy-choice-status" role="status">Stored identifiers and visit records for this browser were deleted.</p>}{forgetState === 'error' && <p className="hm-privacy-choice-status hm-error" role="alert">Deletion failed. Please try again.</p>}</div></div>}</article></section>}
      {mode === 'returns' && <section className="hm-refund-request"><div className="hm-page-heading"><span className="hm-eyebrow">REFUND REQUEST</span><h2>Request a refund</h2><p>Use the order number and the phone number on the original order. Our team will review the request before any refund is issued.</p></div><form className="hm-refund-form" onSubmit={submitRefundRequest}><label>Order number<input required maxLength={80} value={refundForm.order_number} onChange={(event) => setRefundForm({ ...refundForm, order_number: event.target.value })} placeholder="HM20261021-XXXXXXXX" /></label><label>Contact phone<input required maxLength={80} value={refundForm.phone} onChange={(event) => setRefundForm({ ...refundForm, phone: event.target.value })} placeholder="Phone used for this order" /></label><label>Refund reason<textarea required minLength={5} maxLength={1200} rows={4} value={refundForm.reason} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} placeholder="Tell us what happened and why you are requesting a refund." /></label>{refundError && <p className="hm-error" role="alert">{refundError}</p>}<button type="submit" className="hm-button hm-button-blue" disabled={refundSubmitting}>{refundSubmitting ? 'Submitting…' : 'Submit refund request'}</button></form></section>}
      {refundSubmitted && <div className="hm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Refund request submitted"><div className="hm-modal-card"><span className="hm-eyebrow">REQUEST RECEIVED</span><h2>Refund request submitted</h2><p>We received your refund request. Our team will review it and contact you using the phone number you provided.</p><button type="button" className="hm-button hm-button-blue" onClick={() => { setRefundSubmitted(false); setRefundForm({ order_number: '', phone: '', reason: '' }); }}>Close</button></div></div>}
      {gateOpen && <div className="hm-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="hm-gate-title" aria-describedby="hm-gate-desc"><div className="hm-gate-card"><button type="button" className="hm-gate-close" aria-label="Close consent reminder" onClick={closeGate}><X size={18} /></button><span className="hm-eyebrow">COOKIE CONSENT</span><h2 id="hm-gate-title">Allow cookies to continue</h2><p id="hm-gate-desc">We need your consent before the order can be submitted: your cart, order and contact details stay in this browser, and we only add our own anonymous statistics — no advertising trackers. You can withdraw it later in Cookie settings.</p><button type="button" className="hm-button hm-button-blue hm-gate-allow" onClick={allowAndContinue} autoFocus>Allow and continue</button><p className="hm-gate-note">Prefer to read first? <a href="/cookies/">Cookie policy</a></p></div></div>}
    </main>
    <footer className="hm-footer"><div><a className="hm-footer-brand" href="/">{site.brandName || 'Hongmeng Machinery'} <small>{site.brandTagline || 'HONGMENG MACHINERY'}</small></a><p>{pageCopy.footer?.description || site.footer?.description || 'Equipment attachments and support for demanding work.'}</p>{socialLinks.length > 0 && <div className="hm-footer-social">{socialLinks.map(({ platform, label, href }) => <a key={platform} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}><SocialIcon platform={platform} /></a>)}</div>}</div><div><h4>{site.footer?.quickLinksTitle || 'Quick links'}</h4><a href="/shop/">{pageCopy.footer?.productsLabel || 'Shop attachments'}</a><a href="/about/">{pageCopy.footer?.aboutLabel || 'About'}</a><a href="/news/">{pageCopy.footer?.newsLabel || 'News and updates'}</a></div><div><h4>{site.footer?.supportTitle || 'Customer service'}</h4><a href="/contact/">{pageCopy.footer?.contactLabel || 'Contact'}</a><a href="/account/">{pageCopy.footer?.accountLabel || 'My account'}</a><a href="/cart/">{pageCopy.footer?.cartLabel || 'Cart and checkout'}</a></div><div><h4>{pageCopy.footer?.helpTitle || 'Need help?'}</h4><p>{pageCopy.footer?.helpText || 'Contact us about fitment, purchasing, or after-sales support.'}</p>{settings.support_email && <a href={`mailto:${settings.support_email}`}>{settings.support_email}</a>}<a href="/privacy/">{pageCopy.footer?.privacyLabel || 'Privacy policy'}</a><a href="/cookies/">{pageCopy.footer?.cookieLabel || 'Cookie policy'}</a><a href="/terms/">{pageCopy.footer?.termsLabel || 'Sales terms'}</a><a href="/shipping/">{pageCopy.footer?.shippingLabel || 'Shipping policy'}</a><a href="/returns/">{pageCopy.footer?.returnsLabel || 'Returns and refunds'}</a></div><div className="hm-footer-bottom">© {new Date().getFullYear()} {site.brandName || 'Hongmeng Machinery'} · HONGMENG MACHINERY</div></footer>
    {cartOpen && <Drawer open onClose={() => setCartOpen(false)} position="right" className="hm-drawer hm-flowbite-drawer" theme={{ root: { backdrop: 'hm-drawer-backdrop' } }}><div className="hm-drawer-heading"><h2>Cart <small>({count})</small></h2><button type="button" aria-label="Close cart" onClick={() => setCartOpen(false)}><X size={22} /></button></div><CartContents cart={cart} products={products} locale={locale} update={updateCart} emptyMedia={pageCopy.cart?.emptyMedia} onClose={() => setCartOpen(false)} checkoutLink /></Drawer>}
    {detail && mode !== 'product' && <Drawer open onClose={() => setDetail(null)} position="right" className="hm-drawer hm-flowbite-drawer hm-detail-drawer" theme={{ root: { backdrop: 'hm-drawer-backdrop' } }}><div className="hm-drawer-heading"><h2>Product details</h2><button type="button" aria-label="Close details" onClick={() => setDetail(null)}><X size={22} /></button></div><div className="hm-detail-image"><MediaCarousel media={[productImage(detail), ...(detail.gallery || []), ...(detail.videos || []).map((entry) => typeof entry === 'string' ? ({ url: entry, type: 'video' as const, autoplay: false, muted: true }) : entry)]} title={detail.name} fit="contain" /></div><div className="hm-detail-copy"><span className="hm-eyebrow">{detail.category} / {detail.sku}</span><h2>{detail.name}</h2><p>{detail.summary}</p><strong>{money(detail.price_cents, detail.currency)}</strong><button className="hm-button hm-button-blue" type="button" disabled={!detail.available} onClick={() => { add(detail); setDetail(null); }}>Add to cart <Plus size={17} /></button></div></Drawer>}
  </div>, locale)}</LocaleProvider>;
}
