import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/service',
  name: 'ServiceRoot',
  component: DEFAULT_LAYOUT,
  redirect: '/service/inquiries',
  meta: {
    title: '客服',
    locale: '客服',
    requiresAuth: true,
    icon: 'IconCustomerService',
    order: 20,
    hideInMenu: false
  },
  children: [
    {
      path: 'inquiries',
      name: 'ServiceInquiries',
      component: () => import('@/views/operations/inquiries.vue'),
      meta: { title: '会话与询盘', locale: '会话与询盘', requiresAuth: true }
    },
    {
      path: 'agents',
      name: 'ServiceAgents',
      component: () => import('@/views/customers/agents.vue'),
      meta: { title: '客服成员', locale: '客服成员', requiresAuth: true }
    },
    {
      path: 'policy',
      name: 'ServicePolicy',
      component: () => import('@/views/operations/policy.vue'),
      meta: { title: '服务策略', locale: '服务策略', requiresAuth: true }
    },
    {
      path: 'evaluations',
      name: 'ServiceEvaluations',
      component: () => import('@/views/customers/evaluations.vue'),
      meta: { title: '服务评价', locale: '服务评价', requiresAuth: true }
    },
    {
      path: 'visitors',
      name: 'ServiceVisitors',
      component: () => import('@/views/operations/profiles.vue'),
      meta: { title: '访客画像', locale: '访客画像', requiresAuth: true }
    }
  ]
};
