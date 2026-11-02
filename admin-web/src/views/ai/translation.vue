<template>
  <a-row :gutter="16">
    <a-col :xs="24" :lg="14">
      <AiCapabilityStatus capability="translation" />
      <a-card :bordered="false" title="翻译执行参数">
        <a-alert type="info" class="tip">
          模型连接信息统一在「AI 能力 → 模型配置」维护；本页只保留自动翻译开关、批次和超时。
        </a-alert>
        <a-form :model="form" layout="vertical">
          <a-form-item>
            <a-checkbox v-model="form.enabled">保存官网内容后自动翻译中文 / 阿拉伯语</a-checkbox>
          </a-form-item>
          <a-row :gutter="16">
            <a-col :xs="24" :md="12">
              <a-form-item label="每批文案数">
                <a-input-number v-model="form.batchSize" :min="5" :max="100" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :xs="24" :md="12">
              <a-form-item label="请求超时（秒）">
                <a-input-number v-model="form.timeoutSeconds" :min="10" :max="600" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-button type="primary" :loading="saving" @click="save">保存翻译参数</a-button>
        </a-form>
      </a-card>
    </a-col>

    <a-col :xs="24" :lg="10">
      <a-card :bordered="false" title="当前状态">
        <a-descriptions :column="1" bordered>
          <a-descriptions-item label="中文版本">当前官网源内容</a-descriptions-item>
          <a-descriptions-item
            v-for="item in overview?.translations || []"
            :key="item.locale"
            :label="item.locale === 'en' ? '英文' : item.locale === 'ar' ? '阿拉伯语' : item.locale"
          >
            {{ statusLabel(item) }}
          </a-descriptions-item>
        </a-descriptions>
        <a-typography-paragraph class="hint" type="secondary">
          完整的三语进度、重译任务和失败原因在「官网 → 多语言内容」查看。
        </a-typography-paragraph>
        <a-button @click="goTranslations">前往多语言内容</a-button>
      </a-card>
    </a-col>
  </a-row>
</template>

<script lang="ts" setup>
  import { onMounted, reactive, ref } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import { useRouter } from 'vue-router';
  import type { TranslationOverview, TranslationSettingsPayload } from '@/api/translation';
  import { fetchTranslations, saveTranslationSettings } from '@/api/translation';
  import AiCapabilityStatus from '@/components/ai/AiCapabilityStatus.vue';

  const router = useRouter();
  const overview = ref<TranslationOverview | null>(null);
  const saving = ref(false);
  // 上游字段只作为“保存时原样回传”的隐藏值，界面上不再编辑。
  const form = reactive({
    enabled: false,
    apiType: 'chat_completions',
    baseUrl: '',
    model: '',
    batchSize: 20,
    timeoutSeconds: 300,
    configuredModels: [] as string[],
  });

  function statusLabel(item: any) {
    const labels: Record<string, string> = {
      pending: '排队中',
      running: '翻译中',
      ready: '已同步',
      failed: item?.lastError ? `失败：${item.lastError}` : '失败',
      unconfigured: '未配置翻译 AI',
      stale: '待更新',
    };
    return labels[item?.status] || item?.status || '—';
  }

  async function load() {
    overview.value = await fetchTranslations();
    const current = overview.value?.settings;
    if (!current) return;
    Object.assign(form, {
      enabled: Boolean(current.enabled),
      apiType: current.apiType || 'chat_completions',
      baseUrl: current.baseUrl || '',
      model: current.model || '',
      batchSize: Number(current.batchSize || 20),
      timeoutSeconds: Math.max(10, Math.round(Number(current.timeoutMs || 300000) / 1000)),
      configuredModels: current.configuredModels || [],
    });
  }

  function payload(): TranslationSettingsPayload {
    return {
      enabled: form.enabled,
      apiType: form.apiType,
      baseUrl: form.baseUrl,
      model: form.model,
      batchSize: Number(form.batchSize),
      timeoutMs: Number(form.timeoutSeconds) * 1000,
      configuredModels: form.configuredModels,
    };
  }

  async function save() {
    if (!Number.isFinite(Number(form.batchSize)) || Number(form.batchSize) < 5 || Number(form.batchSize) > 100) {
      Message.warning('每批文案数需在 5 - 100 之间');
      return;
    }
    if (!Number.isFinite(Number(form.timeoutSeconds)) || Number(form.timeoutSeconds) < 10 || Number(form.timeoutSeconds) > 600) {
      Message.warning('超时需在 10 - 600 秒之间');
      return;
    }
    saving.value = true;
    try {
      // 先读取最新设置，避免本页旧值覆盖其它页面刚改过的字段。
      await load();
      const result = await saveTranslationSettings(payload());
      Message.success('翻译参数已保存');
      if (overview.value) overview.value.settings = result;
    } catch {
      /* 全局拦截器提示 */
    } finally {
      saving.value = false;
    }
  }

  function goTranslations() {
    router.push('/site/languages');
  }

  onMounted(load);
</script>

<style scoped>
  .tip {
    margin-bottom: 12px;
  }
  .hint {
    margin-top: 12px;
    font-size: 12px;
  }
</style>
