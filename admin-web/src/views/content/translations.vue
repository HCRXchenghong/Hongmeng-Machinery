<template>
  <div class="language-page">
    <a-page-header :show-back="false" title="多语言内容" subtitle="官网中文 / 英文 / 阿拉伯语版本与重译" />

    <a-alert type="info" class="intro" show-icon>
      当前官网以英文内容为源，中文和阿拉伯语可由翻译 AI 生成并按内容版本保存；未生成时前台使用内置词典与默认政策兜底，不会出现英文闪烁。
    </a-alert>

    <a-card :bordered="false" class="toolbar-card">
      <a-space wrap>
        <a-button type="primary" :loading="retranslating === 'all'" :disabled="busy" @click="retranslate('all')">
          重新翻译中文 + 阿拉伯语
        </a-button>
        <a-button :loading="retranslating === 'zh-CN'" :disabled="busy" @click="retranslate('zh-CN')">
          只重译中文
        </a-button>
        <a-button :loading="retranslating === 'ar'" :disabled="busy" @click="retranslate('ar')">
          只重译阿拉伯语
        </a-button>
        <a-button :loading="loading" @click="load">刷新状态</a-button>
        <a-button @click="goAiTranslation">配置翻译 AI</a-button>
      </a-space>
      <a-typography-text type="secondary" class="toolbar-hint">
        任务提交后进入后台队列；本页每 2 秒自动刷新进度，可以随时离开。
      </a-typography-text>
    </a-card>

    <a-spin :loading="loading && !hasLoaded" class="page-spin">
      <a-row :gutter="[16, 16]">
        <a-col v-for="card in cards" :key="card.locale" :xs="24" :md="8">
          <a-card :bordered="false" class="locale-card">
            <template #title>
              <a-space :size="6">
                <span>{{ card.name }}</span>
                <a-tag size="small">{{ card.locale }}</a-tag>
                <a-tag v-if="card.role" size="small" color="arcoblue">{{ card.role }}</a-tag>
              </a-space>
            </template>
            <template #extra>
              <a-tag :color="statusMeta(card).color">{{ statusMeta(card).label }}</a-tag>
            </template>

            <a-progress
              v-if="isActive(card) && card.total"
              type="line"
              size="large"
              :show-text="false"
              :percent="progressRatio(card)"
            />
            <div v-if="isActive(card)" class="progress-text">
              {{ card.total ? `已处理 ${card.done} / ${card.total} 段内容` : '等待队列分配…' }}
            </div>

            <a-descriptions :column="1" size="small" :label-style="{ width: '92px' }">
              <a-descriptions-item label="内容版本">
                <span class="revision" :title="card.revision">{{ shortRevision(card.revision) }}</span>
              </a-descriptions-item>
              <a-descriptions-item label="更新时间">{{ localTime(card.updatedAt) }}</a-descriptions-item>
              <a-descriptions-item v-if="card.note" label="说明">
                <a-typography-text :type="card.status === 'failed' ? 'danger' : 'secondary'">{{ card.note }}</a-typography-text>
              </a-descriptions-item>
            </a-descriptions>

            <a-typography-text type="secondary" class="card-hint">{{ card.hint }}</a-typography-text>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, onUnmounted, ref } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import { useRouter } from 'vue-router';
  import client from '@/api/client';

  type Locale = 'en' | 'zh-CN' | 'ar';
  type StoreTranslation = {
    locale?: string;
    sourceRevision?: string;
    status?: string;
    done?: number;
    total?: number;
    lastError?: string;
    updatedAt?: string | null;
    stale?: boolean;
  };

  const LOCALES: Array<{ locale: Locale; name: string; role: string; hint: string }> = [
    { locale: 'zh-CN', name: '中文', role: '', hint: '有 AI 译文时优先使用；未生成时使用内置中文词典与默认政策。' },
    { locale: 'en', name: '英文', role: '', hint: '当前官网的源内容；修改英文文案请到「官网 → 页面内容」。' },
    { locale: 'ar', name: '阿拉伯语', role: '', hint: '有 AI 译文时优先使用；未生成时使用内置阿拉伯语词典与默认政策。' }
  ];

  const STATUS_META: Record<string, { label: string; color: string }> = {
    ready: { label: '已同步', color: 'green' },
    pending: { label: '排队中', color: 'orange' },
    running: { label: '翻译中', color: 'arcoblue' },
    stale: { label: '待更新', color: 'orange' },
    failed: { label: '失败', color: 'red' },
    unconfigured: { label: '未配置', color: 'gray' },
    unavailable: { label: '不可用', color: 'gray' }
  };

  const router = useRouter();
  const translations = ref<Record<string, StoreTranslation>>({});
  const loading = ref(false);
  const hasLoaded = ref(false);
  const retranslating = ref<'all' | Locale | null>(null);
  const busy = computed(() => retranslating.value !== null);
  let timer: number | null = null;

  const cards = computed(() =>
    LOCALES.map((item) => {
      const state = translations.value[item.locale] || {};
      const status = state.status || 'unconfigured';
      const role = item.locale === 'en' ? '' : status === 'ready' ? 'AI 译文' : '词典兜底';
      const note = item.locale === 'en'
        ? ''
        : status === 'unconfigured'
          ? '尚未配置翻译 AI，当前使用内置词典兜底；配置后可生成正式译文。'
          : status === 'failed'
            ? state.lastError || '翻译失败，请检查翻译 AI 配置后重试。'
            : '';
      return {
        ...item,
        role,
        note,
        revision: state.sourceRevision || '',
        status,
        stale: Boolean(state.stale),
        done: Number(state.done) || 0,
        total: Number(state.total) || 0,
        lastError: state.lastError || '',
        updatedAt: state.updatedAt || null
      };
    })
  );

  function statusOf(status: string) {
    return STATUS_META[status] || { label: status || '未知', color: 'gray' };
  }

  function statusMeta(card: { locale: Locale; status: string; revision: string; updatedAt: string | null }) {
    if (card.locale === 'en') return { label: '源内容', color: 'green' };
    return statusOf(card.status);
  }

  function isActive(card: { status: string }) {
    return ['pending', 'running'].includes(card.status);
  }

  function progressRatio(card: { done: number; total: number }) {
    if (!card.total) return 0;
    return Math.min(1, Math.max(0, card.done / card.total));
  }

  function shortRevision(value: string) {
    return value ? value.slice(0, 10) : '-';
  }

  function localTime(value?: string | null) {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
  }

  async function load() {
    loading.value = true;
    try {
      const response = await client.get('/site-admin-api/commerce/translations');
      translations.value = response.data.data || {};
      hasLoaded.value = true;
      syncPolling();
    } catch {
      /* 错误提示由全局响应拦截器统一给出 */
    } finally {
      loading.value = false;
    }
  }

  function stopPolling() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function syncPolling() {
    const active = cards.value.some((card) => isActive(card));
    if (active && timer === null) {
      timer = window.setInterval(() => { void load(); }, 2000);
    } else if (!active && timer !== null) {
      stopPolling();
    }
  }

  async function retranslate(target: 'all' | Locale) {
    if (busy.value) return;
    retranslating.value = target;
    try {
      if (target === 'all') {
        await Promise.all([
          client.post('/site-admin-api/commerce/translations/retranslate', { locale: 'zh-CN' }),
          client.post('/site-admin-api/commerce/translations/retranslate', { locale: 'ar' })
        ]);
        Message.success('中文和阿拉伯语翻译任务已提交');
      } else {
        await client.post('/site-admin-api/commerce/translations/retranslate', { locale: target });
        Message.success(`${target === 'zh-CN' ? '中文' : '阿拉伯语'}翻译任务已提交`);
      }
      await load();
    } catch {
      /* 错误提示由全局响应拦截器统一给出 */
    } finally {
      retranslating.value = null;
      syncPolling();
    }
  }

  function goAiTranslation() {
    router.push('/ai/translation');
  }

  onMounted(load);
  onUnmounted(stopPolling);
</script>

<style scoped lang="less">
  .language-page {
    .intro {
      margin-bottom: 16px;
    }
    .toolbar-card {
      margin-bottom: 16px;
    }
    .toolbar-hint {
      display: block;
      margin-top: 10px;
      font-size: 12px;
    }
    .page-spin {
      width: 100%;
      min-height: 240px;
    }
    .locale-card {
      height: 100%;
    }
    .progress-text {
      margin: 4px 0 12px;
      color: var(--color-text-3);
      font-size: 12px;
    }
    .revision {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .card-hint {
      display: block;
      margin-top: 12px;
      font-size: 12px;
    }
  }
</style>
