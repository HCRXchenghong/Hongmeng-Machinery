import { createRouter, createWebHistory } from 'vue-router';
import NProgress from 'nprogress'; // progress bar
import 'nprogress/nprogress.css';

import { appRoutes } from './routes';
import { REDIRECT_MAIN, NOT_FOUND_ROUTE } from './routes/base';
import { legacyRedirectRoutes } from './routes/legacy';
import createRouteGuard from './guard';
import { DEFAULT_ROUTE } from './constants';

NProgress.configure({ showSpinner: false }); // NProgress Configuration

// 后台 SPA 挂在 /site-admin/ 下；旧站独立页面已下线，旧地址统一由 legacy.ts 重定向。
const router = createRouter({
  history: createWebHistory('/site-admin/'),
  routes: [
    {
      path: '/',
      redirect: DEFAULT_ROUTE,
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/login/index.vue'),
      meta: {
        requiresAuth: false,
      },
    },
    ...appRoutes,
    ...legacyRedirectRoutes,
    REDIRECT_MAIN,
    NOT_FOUND_ROUTE,
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

createRouteGuard(router);

export default router;
