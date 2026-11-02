import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/apps',
  name: 'AppsRoot',
  component: DEFAULT_LAYOUT,
  redirect: '/apps/releases',
  meta: {
    title: '应用',
    locale: '应用',
    requiresAuth: true,
    icon: 'IconApps',
    order: 60,
    hideInMenu: false
  },
  children: [
    {
      path: 'releases',
      name: 'AppReleases',
      component: () => import('@/views/apps/releases.vue'),
      meta: { title: '应用版本', locale: '应用版本', requiresAuth: true }
    },
    {
      path: 'api',
      name: 'AppApi',
      component: () => import('@/views/apps/api.vue'),
      meta: { title: '接口授权', locale: '接口授权', requiresAuth: true }
    }
  ]
};
