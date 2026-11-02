import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/dashboard',
  name: 'DashboardRoot',
  component: DEFAULT_LAYOUT,
  meta: {
    title: '工作台',
    locale: '工作台',
    requiresAuth: true,
    icon: 'IconDashboard',
    order: 10,
    hideInMenu: false
  },
  children: [
    {
      path: '',
      name: 'Workspace',
      component: () => import('@/views/dashboard/index.vue'),
      meta: {
        title: '经营概览',
        locale: '经营概览',
        requiresAuth: true
      }
    }
  ]
};
