import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/site',
  name: 'SiteRoot',
  component: DEFAULT_LAYOUT,
  redirect: '/site/pages',
  meta: {
    title: '官网',
    locale: '官网',
    requiresAuth: true,
    icon: 'IconFile',
    order: 30,
    hideInMenu: false
  },
  children: [
    {
      path: 'pages',
      name: 'SitePages',
      component: () => import('@/views/commerce/manage.vue'),
      props: { section: 'content' },
      meta: { title: '页面内容', locale: '页面内容', requiresAuth: true }
    },
    {
      path: 'seo',
      name: 'SiteSeo',
      component: () => import('@/views/content/seo.vue'),
      meta: { title: 'SEO 设置', locale: 'SEO 设置', requiresAuth: true }
    },
    {
      path: 'languages',
      name: 'SiteLanguages',
      component: () => import('@/views/content/translations.vue'),
      meta: { title: '多语言内容', locale: '多语言内容', requiresAuth: true }
    },
    {
      path: 'media',
      name: 'SiteMedia',
      component: () => import('@/views/content/media.vue'),
      meta: { title: '媒体素材', locale: '媒体素材', requiresAuth: true }
    }
  ]
};
