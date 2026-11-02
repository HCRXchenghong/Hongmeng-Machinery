<template>
  <div class="ai-workbench">
    <a-card :bordered="false" class="ai-parameters">
      <template #title>生图参数</template>
      <template #extra>
        <a-tag :color="configured ? 'green' : 'red'">
          {{ configured ? 'AI 已配置' : 'AI 未配置' }}
        </a-tag>
      </template>

      <a-alert v-if="capabilityError" type="error" class="ai-alert">
        无法读取 AI 能力：{{ capabilityError }}
      </a-alert>

      <div v-if="!configured" class="not-configured">
        <a-empty description="尚未绑定生图模型" />
        <p class="not-configured-tip">
          请先在「AI 能力 → 模型配置」创建生图供应商并绑定「生图」能力，保存并验证通过后即可使用。
        </p>
        <a-space>
          <a-button :loading="modelsLoading" @click="loadModels(true)">重新检查</a-button>
          <a-link href="/site-admin/ai/models" target="_self">前往模型配置</a-link>
        </a-space>
      </div>

      <template v-else>
        <div class="field">
          <label>提示词</label>
          <a-textarea
            v-model="prompt"
            :max-length="4000"
            :auto-size="{ minRows: 6, maxRows: 12 }"
            placeholder="描述产品、场景、构图、光线、材质和风格…"
          />
          <span class="field-help">{{ prompt.length }} / 4000</span>
        </div>

        <div class="field-row">
          <div class="field">
            <label>尺寸</label>
            <a-select v-model="size">
              <a-option v-for="option in SIZES" :key="option.value" :value="option.value">
                {{ option.label }}
              </a-option>
            </a-select>
          </div>
          <div class="field">
            <label>质量</label>
            <a-select v-model="quality">
              <a-option v-for="option in QUALITIES" :key="option.value" :value="option.value">
                {{ option.label }}
              </a-option>
            </a-select>
          </div>
        </div>

        <div class="field">
          <label>模型</label>
          <a-typography-text>{{ model || '由「AI 能力 → 模型配置」中的生图绑定决定' }}</a-typography-text>
        </div>

        <div class="field">
          <label>上传分类</label>
          <a-select v-model="category">
            <a-option v-for="name in categoryOptions" :key="name" :value="name">{{ name }}</a-option>
          </a-select>
        </div>

        <a-button
          type="primary"
          long
          class="generate-button"
          :loading="generating"
          @click="generatePreview"
        >
          生成图片
        </a-button>
        <p class="form-state" :class="stateClass">{{ stateText }}</p>

        <a-collapse ghost class="safety-block">
          <a-collapse-item key="safety" header="安全约束（后台可配置）">
            <a-textarea
              v-model="safetyPrompt"
              :max-length="2000"
              :auto-size="{ minRows: 3, maxRows: 8 }"
              placeholder="例如：不要生成任何品牌 logo、商标、文字、水印或竞品标识"
            />
            <p class="safety-hint">
              每次生成自动追加到提示词末尾；留空表示关闭。保存后立即生效。
            </p>
            <a-button size="small" :loading="savingSafety" @click="saveSafety">保存安全约束</a-button>
          </a-collapse-item>
        </a-collapse>
      </template>
    </a-card>

    <a-card :bordered="false" class="ai-results">
      <template #title>生成结果</template>
      <template #extra>
        <a-tag>{{ results.length }} 张</a-tag>
      </template>

      <a-empty v-if="!results.length" description="还没有生成结果，请在左侧输入提示词并点击“生成图片”。" />

      <div v-else class="ai-result-grid">
        <article v-for="item in results" :key="item.id" class="ai-result-card">
          <div class="ai-result-image">
            <img :src="item.dataUrl" :alt="`AI 生成结果 ${item.id}`" />
          </div>
          <div class="ai-result-info">
            <div class="ai-result-meta">
              <span>{{ item.size || '—' }} · {{ formatBytes(item.bytes) }}</span>
              <a-tag size="small" :color="item.status === 'error' ? 'red' : 'gray'">
                {{ statusLabel(item.status) }}
              </a-tag>
            </div>
            <div class="ai-result-actions">
              <a-button
                type="primary"
                size="small"
                :loading="item.status === 'uploading'"
                :disabled="!['pending', 'error'].includes(item.status)"
                @click="commitPreview(item)"
              >
                {{ item.status === 'uploaded' ? '已上传' : '直接上传使用' }}
              </a-button>
              <a-button
                size="small"
                :disabled="item.status === 'uploading'"
                @click="discardPreview(item)"
              >
                {{ item.status === 'uploaded' ? '移除结果' : '放弃' }}
              </a-button>
              <a-button size="small" @click="downloadPreview(item, 'png')">导出 PNG</a-button>
              <a-button size="small" @click="downloadPreview(item, 'webp')">导出 WebP</a-button>
            </div>
          </div>
        </article>
      </div>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref, watch } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import {
    aiCommitPreview,
    aiDiscardPreview,
    aiPreview,
    aiPreviewExportUrl,
    fetchAiModels,
    updateAiImageSafetyPrompt,
  } from '@/api/media';
  import type { AiCapability, AiPreviewItem, MediaCategory, MediaSettings } from '@/api/media';
  import { formatBytes } from '@/lib/media';

  type PreviewStatus = 'pending' | 'uploading' | 'uploaded' | 'error';
  interface PreviewResult extends AiPreviewItem {
    status: PreviewStatus;
  }

  const SIZES = [
    { value: '1024x1024', label: '1:1 正方形' },
    { value: '1536x1024', label: '3:2 横版' },
    { value: '1024x1536', label: '2:3 竖版' },
    { value: '1792x1024', label: '16:9 横版' },
    { value: '1024x1792', label: '9:16 竖版' },
  ];
  const QUALITIES = [
    { value: 'auto', label: '自动' },
    { value: 'medium', label: '中等' },
    { value: 'high', label: '高' },
    { value: 'standard', label: '标准' },
    { value: 'hd', label: 'HD' },
  ];

  const props = withDefaults(
    defineProps<{ categories?: MediaCategory[]; settings?: MediaSettings | null }>(),
    { categories: () => [], settings: null }
  );
  const emit = defineEmits<{ (e: 'changed'): void }>();

  const capability = ref<AiCapability | null>(null);
  const capabilityError = ref('');
  const modelsLoading = ref(false);
  const generating = ref(false);
  const prompt = ref('');
  const size = ref('1024x1024');
  const quality = ref('auto');
  const model = ref('');
  const category = ref('未分类');
  const results = ref<PreviewResult[]>([]);
  const stateText = ref('临时结果保留 15 分钟，不会自动进入素材库。');
  const stateClass = ref('');
  const safetyPrompt = ref('');
  const savingSafety = ref(false);

  const models = computed(() => capability.value?.models || []);
  const configured = computed(
    () =>
      capability.value?.configured ??
      props.settings?.aiImage?.configured ??
      props.settings?.config?.aiImage?.apiKeyConfigured ??
      false
  );
  const categoryOptions = computed(() => {
    const names = props.categories.map((item) => item.name);
    return names.includes('未分类') ? names : ['未分类', ...names];
  });

  function statusLabel(status: PreviewStatus) {
    return { pending: '待处理', uploading: '上传中', uploaded: '已上传', error: '失败' }[status];
  }

  async function loadModels(refresh = false) {
    modelsLoading.value = true;
    capabilityError.value = '';
    try {
      const payload = await fetchAiModels(refresh);
      capability.value = payload.data || {};
      const list = capability.value.models || [];
      if (!model.value || !list.includes(model.value)) {
        model.value = capability.value.defaultModel || list[0] || '';
      }
    } catch (error: any) {
      capabilityError.value = error?.message || '请求失败';
    } finally {
      modelsLoading.value = false;
    }
  }

  async function generatePreview() {
    const text = prompt.value.trim();
    if (!text) {
      Message.warning('请先输入生图提示词。');
      return;
    }
    generating.value = true;
    stateClass.value = '';
    stateText.value = '正在请求 AI 生图，结果不会自动入库…';
    try {
      const payload = await aiPreview({
        prompt: text,
        model: model.value || undefined,
        size: size.value,
        quality: quality.value,
      });
      results.value.unshift({ ...payload.data, status: 'pending' });
      stateClass.value = 'success';
      const [expectedWidth, expectedHeight] = size.value.split('x').map(Number);
      const actual = payload.data.width && payload.data.height
        ? `${payload.data.width}×${payload.data.height}`
        : '';
      stateText.value = `生成成功，临时结果将在 ${new Date(payload.data.expiresAt).toLocaleString(
        'zh-CN',
        { hour12: false }
      )} 前有效${actual ? `，实际尺寸 ${actual}` : ''}。`;
      if (actual && (payload.data.width !== expectedWidth || payload.data.height !== expectedHeight)) {
        Message.warning(`服务商实际返回 ${actual}，与所选尺寸不一致，已按实际尺寸入库。`);
      } else {
        Message.success('生成成功，请在结果区选择上传或放弃。');
      }
    } catch (error: any) {
      stateClass.value = 'error';
      stateText.value = error?.message || '生成失败。';
    } finally {
      generating.value = false;
    }
  }

  async function commitPreview(item: PreviewResult) {
    item.status = 'uploading';
    try {
      const payload = await aiCommitPreview(item.id, {
        category: category.value,
        preserveOriginal: props.settings?.config?.image?.keepOriginal !== false,
      });
      item.status = 'uploaded';
      Message.success(`已上传到素材管理（${payload.data.category}）。`);
      emit('changed');
    } catch {
      item.status = 'error';
    }
  }

  async function discardPreview(item: PreviewResult) {
    try {
      if (item.status !== 'uploaded') await aiDiscardPreview(item.id);
      results.value = results.value.filter((entry) => entry.id !== item.id);
      Message.success(item.status === 'uploaded' ? '已从结果区移除。' : '临时结果已放弃。');
    } catch {
      // 错误提示已由响应拦截器统一处理。
    }
  }

  function syncSafetyPrompt() {
    safetyPrompt.value = String(props.settings?.config?.aiImage?.safetyPrompt || '');
  }

  async function saveSafety() {
    savingSafety.value = true;
    try {
      await updateAiImageSafetyPrompt(safetyPrompt.value.trim());
      Message.success('安全约束已保存');
    } catch (error: any) {
      Message.error(error?.response?.data?.error?.message || error?.message || '安全约束保存失败');
    } finally {
      savingSafety.value = false;
    }
  }

  function downloadPreview(item: PreviewResult, format: 'png' | 'webp') {
    const link = document.createElement('a');
    link.href = aiPreviewExportUrl(item.id, format);
    link.download = `ai-${item.id}.${format}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  watch(() => props.settings, syncSafetyPrompt, { immediate: true, deep: true });

  onMounted(() => {
    loadModels(false);
  });
</script>

<style scoped>
  .ai-workbench {
    display: grid;
    grid-template-columns: minmax(300px, 380px) 1fr;
    gap: 12px;
    align-items: start;
  }

  @media (max-width: 1100px) {
    .ai-workbench {
      grid-template-columns: 1fr;
    }
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .field label {
    color: var(--color-text-2);
    font-size: 13px;
  }

  .field-row {
    display: flex;
    gap: 12px;
  }

  .field-row .field {
    flex: 1;
  }

  .field-help {
    align-self: flex-end;
    color: var(--color-text-3);
    font-size: 12px;
  }

  .model-row {
    width: 100%;
  }

  .generate-button {
    margin-top: 4px;
  }

  .form-state {
    margin: 10px 0 0;
    color: var(--color-text-3);
    font-size: 12px;
  }

  .form-state.success {
    color: rgb(var(--success-6));
  }

  .form-state.error {
    color: rgb(var(--danger-6));
  }

  .not-configured {
    padding: 8px 0;
  }

  .not-configured-tip {
    color: var(--color-text-3);
    font-size: 12px;
    text-align: center;
  }

  .ai-alert {
    margin-bottom: 12px;
  }

  .safety-block {
    margin-top: 12px;
    border-top: 1px solid var(--color-border-2);
  }

  .safety-hint {
    margin: 6px 0;
    color: var(--color-text-3);
    font-size: 12px;
  }

  .ai-result-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }

  .ai-result-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-2);
    border-radius: 8px;
    overflow: hidden;
  }

  .ai-result-image {
    height: 180px;
    background: var(--color-fill-1);
  }

  .ai-result-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .ai-result-info {
    padding: 10px 12px 12px;
  }

  .ai-result-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--color-text-3);
    font-size: 12px;
  }

  .ai-result-actions {
    display: flex;
    gap: 8px;
  }
</style>
