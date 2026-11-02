import { DEFAULT_LAYOUT } from '../base';

export default {
  path: '/ai',
  name: 'AiRoot',
  component: DEFAULT_LAYOUT,
  redirect: '/ai/models',
  meta: {
    title: 'AI 能力',
    locale: 'AI 能力',
    requiresAuth: true,
    icon: 'IconRobot',
    order: 50,
    hideInMenu: false
  },
  children: [
    {
      path: 'models',
      name: 'AiModels',
      component: () => import('@/views/ai/manage.vue'),
      props: { section: 'models' },
      meta: { title: '模型配置', locale: '模型配置', requiresAuth: true }
    },
    {
      path: 'reception',
      name: 'AiReception',
      component: () => import('@/views/ai/manage.vue'),
      props: { section: 'reception' },
      meta: { title: '接待 AI', locale: '接待 AI', requiresAuth: true }
    },
    {
      path: 'translation',
      name: 'AiTranslation',
      component: () => import('@/views/ai/manage.vue'),
      props: { section: 'translation' },
      meta: { title: '翻译 AI', locale: '翻译 AI', requiresAuth: true }
    },
    {
      path: 'image',
      name: 'AiImage',
      component: () => import('@/views/ai/manage.vue'),
      props: { section: 'image' },
      meta: { title: 'AI 生图', locale: 'AI 生图', requiresAuth: true }
    },
    {
      path: 'limits',
      name: 'AiLimits',
      component: () => import('@/views/ai/manage.vue'),
      props: { section: 'limits' },
      meta: { title: '调用限额', locale: '调用限额', requiresAuth: true }
    },
    {
      path: 'knowledge',
      name: 'AiKnowledge',
      component: () => import('@/views/ai/knowledge.vue'),
      meta: { title: '知识库', locale: '知识库', requiresAuth: true }
    }
  ]
};
