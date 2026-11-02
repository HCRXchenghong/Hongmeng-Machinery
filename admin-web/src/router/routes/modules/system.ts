import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/system',
  name: 'SystemRoot',
  component: DEFAULT_LAYOUT,
  redirect: '/system/logs',
  meta: {
    title: '系统',
    locale: '系统',
    requiresAuth: true,
    icon: 'IconSettings',
    order: 70,
    hideInMenu: false
  },
  children: [
    {
      path: 'logs',
      name: 'SystemLogs',
      component: () => import('@/views/system/logs.vue'),
      meta: { title: '系统日志', locale: '系统日志', requiresAuth: true }
    },
    {
      path: 'settings',
      name: 'SystemSettings',
      component: () => import('@/views/system/settings.vue'),
      meta: { title: '系统设置', locale: '系统设置', requiresAuth: true }
    }
  ]
};
