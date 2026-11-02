import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/store',
  name: 'StoreRoot',
  component: DEFAULT_LAYOUT,
  redirect: '/store/products',
  meta: {
    title: '商城',
    locale: '商城',
    requiresAuth: true,
    icon: 'IconGift',
    order: 40,
    hideInMenu: false
  },
  children: [
    {
      path: 'products',
      name: 'StoreProducts',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'products' },
      meta: { title: '商品库存', locale: '商品库存', requiresAuth: true }
    },
    {
      path: 'orders',
      name: 'StoreOrders',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'orders' },
      meta: { title: '订单处理', locale: '订单处理', requiresAuth: true }
    },
    {
      path: 'customers',
      name: 'StoreCustomers',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'customers' },
      meta: { title: '客户资料', locale: '客户资料', requiresAuth: true }
    },
    {
      path: 'checkout',
      name: 'StoreCheckout',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'settings' },
      meta: { title: '结算与运费', locale: '结算与运费', requiresAuth: true }
    },
    {
      path: 'payments',
      name: 'StorePayments',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'integrations' },
      meta: { title: '支付', locale: '支付', requiresAuth: true }
    },
    {
      path: 'policies',
      name: 'StorePolicies',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'policies' },
      meta: { title: '店铺政策', locale: '店铺政策', requiresAuth: true }
    }
  ]
};
