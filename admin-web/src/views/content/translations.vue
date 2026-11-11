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

            <a-divider orientation="left" style="margin: 12px 0">界面词条（语言包）</a-divider>
            <a-space direction="vertical" style="width: 100%" size="8">
              <a-radio-group
                :model-value="packMode(card.locale)"
                type="button"
                size="small"
                :disabled="!isPackLocale(card.locale)"
                @change="(value: string | number | boolean) => setPackMode(card.locale, String(value))"
              >
                <a-radio value="pack">语言包优先</a-radio>
                <a-radio value="ai">交给 AI / 内置词典</a-radio>
              </a-radio-group>
              <a-typography-text type="secondary" style="font-size: 12px">
                {{ packSummary(card.locale) }}
              </a-typography-text>
              <a-space wrap size="6">
                <a-button size="mini" :loading="seeding === card.locale" :disabled="!isPackLocale(card.locale)" @click="seedPack(card.locale)">从内置词条生成</a-button>
                <a-button size="mini" :disabled="!isPackLocale(card.locale)" @click="openPack(card.locale)">导入 / 查看</a-button>
              </a-space>
            </a-space>

            <a-typography-text type="secondary" class="card-hint">{{ card.hint }}</a-typography-text>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <a-modal v-model:visible="packVisible" :title="`界面词条语言包 · ${packLocale}`" :width="760" :footer="false" unmount-on-close>
      <a-space direction="vertical" style="width: 100%" size="12">
        <a-alert type="info">
          粘贴或上传 { "原文": "译文" } 形式的 JSON。保存后会触发官网重建，约 10 秒生效；
          切换「交给 AI / 内置词典」则忽略语言包、回到内置词条。
        </a-alert>
        <a-space wrap>
          <a-upload :auto-upload="false" :show-file-list="false" accept=".json" @change="onPackFile">
            <a-button size="small">选择 JSON 文件</a-button>
          </a-upload>
          <a-button size="small" :loading="filling === packLocale" @click="aiFill">用 AI 补齐缺失词条</a-button>
          <a-button size="small" status="danger" :disabled="savingPack" @click="clearPack">清空语言包</a-button>
        </a-space>
        <a-textarea v-model="packText" :auto-size="{ minRows: 12, maxRows: 24 }" placeholder='{ "Add to cart": "加入购物车" }' />
        <a-space>
          <a-button type="primary" :loading="savingPack" @click="savePack">保存语言包</a-button>
          <a-typography-text type="secondary">{{ packValidation }}</a-typography-text>
        </a-space>
      </a-space>
    </a-modal>
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

  type PackInfo = { locale: string; mode: 'pack' | 'ai'; count: number; source: string; updatedAt: string; aiFilled: number };
  const packs = ref<Record<string, PackInfo>>({});
  const packVisible = ref(false);
  const packLocale = ref<'zh-CN' | 'ar'>('zh-CN');
  const packText = ref('');
  const packValidation = ref('');
  const savingPack = ref(false);
  const seeding = ref('');
  const filling = ref('');

  const isPackLocale = (locale: Locale) => locale === 'zh-CN' || locale === 'ar';
  const packMode = (locale: Locale) => (packs.value[locale]?.mode === 'ai' ? 'ai' : 'pack');
  function packSummary(locale: Locale) {
    const info = packs.value[locale];
    if (!info) return '尚未读取语言包状态';
    if (!info.count) return '暂无语言包条目——可点「从内置词条生成」或导入专业译稿';
    const modeLabel = info.mode === 'ai' ? '当前交给 AI / 内置词典' : '当前使用语言包';
    const extra = info.aiFilled ? `，其中 AI 补齐 ${info.aiFilled} 条` : '';
    return `${modeLabel}：${info.count} 条${extra}，更新于 ${localTime(info.updatedAt)}`;
  }
  function applyPackSummary(list: PackInfo[]) {
    packs.value = Object.fromEntries(list.map((item) => [item.locale, item]));
  }
  async function loadPacks() {
    try {
      const response = await client.get('/site-admin-api/language-packs');
      applyPackSummary(response.data?.data?.locales || []);
    } catch {
      /* 统一由拦截器提示 */
    }
  }
  async function setPackMode(locale: Locale, mode: string) {
    if (!isPackLocale(locale)) return;
    try {
      const response = await client.patch(`/site-admin-api/language-packs/${locale}/mode`, { mode });
      applyPackSummary(response.data?.data?.locales || []);
      Message.success(mode === 'ai' ? '已改为交给 AI / 内置词典，正在重建官网' : '已改为语言包优先，正在重建官网');
    } catch {
      /* 统一提示 */
    }
  }
  async function seedPack(locale: Locale) {
    if (!isPackLocale(locale)) return;
    seeding.value = locale;
    try {
      const response = await client.post(`/site-admin-api/language-packs/${locale}/seed`);
      applyPackSummary(response.data?.data?.locales || []);
      Message.success('已用内置词条生成语言包，可继续导入专业译稿覆盖');
    } catch {
      /* 统一提示 */
    } finally {
      seeding.value = '';
    }
  }
  async function openPack(locale: Locale) {
    if (!isPackLocale(locale)) return;
    packLocale.value = locale;
    packVisible.value = true;
    packValidation.value = '';
    try {
      const response = await client.get(`/site-admin-api/language-packs/${locale}`);
      const entries = response.data?.data?.entries || {};
      packText.value = Object.keys(entries).length ? JSON.stringify(entries, null, 2) : '';
    } catch {
      packText.value = '';
    }
  }
  function onPackFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      packText.value = String(reader.result || '');
      packValidation.value = '已读取文件，保存前会自动校验格式';
    };
    reader.readAsText(file);
    return false;
  }
  async function savePack() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(packText.value || '{}');
    } catch (error: any) {
      Message.error(`JSON 解析失败：${error.message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      Message.error('语言包必须是 { "原文": "译文" } 形式的对象');
      return;
    }
    savingPack.value = true;
    try {
      const response = await client.put(`/site-admin-api/language-packs/${packLocale.value}`, { entries: parsed });
      applyPackSummary(response.data?.data?.locales || []);
      Message.success(`已保存 ${Object.keys(parsed as Record<string, string>).length} 条词条，官网正在重建`);
      packVisible.value = false;
    } catch (error: any) {
      Message.error(error?.response?.data?.error?.message || '语言包保存失败');
    } finally {
      savingPack.value = false;
    }
  }
  async function clearPack() {
    try {
      const response = await client.delete(`/site-admin-api/language-packs/${packLocale.value}`);
      applyPackSummary(response.data?.data?.locales || []);
      packText.value = '';
      Message.success('语言包已清空，官网正在重建');
    } catch {
      /* 统一提示 */
    }
  }
  async function aiFill() {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(packText.value || '{}');
    } catch {
      Message.error('请先粘贴要翻译的原文词条（JSON 对象）');
      return;
    }
    filling.value = packLocale.value;
    try {
      const response = await client.post(`/site-admin-api/language-packs/${packLocale.value}/ai-fill`, { entries: parsed });
      const filled = response.data?.data?.filled ?? 0;
      applyPackSummary(response.data?.data?.summary?.locales || []);
      Message.success(filled ? `AI 已补齐 ${filled} 条缺失词条` : '没有需要补齐的词条');
    } catch (error: any) {
      Message.error(error?.response?.data?.error?.message || 'AI 补齐失败');
    } finally {
      filling.value = '';
    }
  }

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

  onMounted(() => {
    void load();
    void loadPacks();
  });
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
