import type { RouteLocation, RouteRecordRaw } from 'vue-router';

/**
 * 旧地址兼容层：只做重定向，不参与菜单。
 * 新菜单以“工作台 / 客服 / 官网 / 商城 / AI 能力 / 应用 / 系统”为准。
 */
function legacy(path: string, redirect: RouteRecordRaw['redirect'], title: string): RouteRecordRaw {
  return {
    path,
    redirect,
    meta: { title, locale: title, requiresAuth: true, hideInMenu: true }
  };
}

const commerceTabTargets: Record<string, string> = {
  products: '/store/products',
  orders: '/store/orders',
  customers: '/store/customers',
  settings: '/store/checkout',
  integrations: '/store/payments',
  policies: '/store/policies',
  content: '/site/pages'
};

const aiTabTargets: Record<string, string> = {
  providers: '/ai/models',
  bindings: '/ai/models',
  reception: '/ai/reception',
  translation: '/ai/translation',
  seo: '/site/seo',
  image: '/ai/image',
  limits: '/ai/limits'
};

export const legacyRedirectRoutes: RouteRecordRaw[] = [
  // 工作台 / 客服
  legacy('/workspace', '/service/inquiries', '会话与询盘'),
  legacy('/customers', '/service/agents', '客服成员'),
  legacy('/customers/agents', '/service/agents', '客服成员'),
  legacy('/customers/evaluations', '/service/evaluations', '服务评价'),
  legacy('/operations', '/service/inquiries', '客服'),
  legacy('/operations/inquiries', '/service/inquiries', '会话与询盘'),
  legacy('/operations/profiles', '/service/visitors', '访客画像'),
  legacy('/operations/policy', '/service/policy', '服务策略'),
  legacy('/operations/agents', '/service/agents', '客服成员'),
  legacy('/operations/evaluations', '/service/evaluations', '服务评价'),
  legacy('/operations/keywords', '/service/policy', '服务策略'),
  legacy('/operations/blacklist', '/service/policy', '服务策略'),
  legacy('/operations/queue', '/service/policy', '服务策略'),
  legacy('/operations/leads', '/service/inquiries?tab=leads', '表单留言'),

  // 官网
  legacy('/content', '/site/pages', '页面内容'),
  legacy('/content/site', '/site/pages', '页面内容'),
  legacy('/content/translations', '/site/languages', '多语言内容'),
  legacy('/content/media', '/site/media', '媒体素材'),

  // 商城
  legacy('/commerce', '/store/products', '商品库存'),
  legacy('/commerce/manage', (to: RouteLocation) => {
    const tab = typeof to.query.tab === 'string' ? to.query.tab : '';
    return commerceTabTargets[tab] || '/store/products';
  }, '商城'),

  // AI
  legacy('/ai/manage', (to: RouteLocation) => {
    const tab = typeof to.query.tab === 'string' ? to.query.tab : '';
    return aiTabTargets[tab] || '/ai/models';
  }, 'AI 能力'),
  legacy('/ai/seo', '/site/seo', 'SEO 设置'),
  legacy('/ai/providers', '/ai/models', '模型与能力'),

  // 应用 / 系统
  legacy('/apps', '/apps/releases', '应用'),
  legacy('/system', '/system/logs', '系统'),
  legacy('/system/audit', '/system/logs?tab=audit', '系统日志'),
  legacy('/system/general', '/system/settings?tab=general', '系统设置'),
  legacy('/system/push', '/system/settings?tab=push', '系统设置'),
  legacy('/system/alerts', '/system/settings?tab=alerts', '系统设置'),
  legacy('/system/mail', '/system/settings?tab=mail', '系统设置'),
  legacy('/system/profile', '/service/visitors', '访客画像'),
  legacy('/system/ai', '/ai/models', '模型与能力')
];

export default legacyRedirectRoutes;
