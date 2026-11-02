<template>
  <a-alert
    class="ai-capability-status"
    :type="configured ? 'success' : 'warning'"
    show-icon
  >
    <template #title>
      当前模型：{{ configured ? `${providerName} / ${modelName || '默认模型'}` : '未绑定' }}
    </template>
    <div class="status-line">
      <span v-if="configured">该能力由「AI 能力 → 模型配置」统一提供，URL、Key 与模型不在本页维护。</span>
      <span v-else>请先在「AI 能力 → 模型配置」创建供应商，并把该能力绑定到供应商。</span>
      <a-button size="mini" type="outline" @click="openModels">去模型配置</a-button>
    </div>
    <a-typography-text v-if="errorText" type="danger" class="status-error">{{ errorText }}</a-typography-text>
  </a-alert>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { fetchAiBindingTargets, fetchAiBindings, fetchAiProviders } from '@/api/admin';

  type Capability = 'reception' | 'translation' | 'seo' | 'image';

  const props = defineProps<{ capability: Capability }>();
  const router = useRouter();
  const configured = ref(false);
  const providerName = ref('');
  const modelName = ref('');
  const errorText = ref('');

  const label = computed(
    () =>
      ({
        reception: '接待',
        translation: '翻译',
        seo: '搜索优化',
        image: '生图'
      })[props.capability]
  );

  async function load() {
    errorText.value = '';
    try {
      const [providerPayload, bindingPayload, targetPayload] = await Promise.all([
        fetchAiProviders(),
        fetchAiBindings(),
        fetchAiBindingTargets().catch(() => ({ targets: [] }))
      ]);
      const providers = providerPayload?.providers || [];
      const defaultBinding = (bindingPayload?.bindings || []).find(
        (item: any) => item?.capability === props.capability && item?.provider_id
      );
      const backup = (targetPayload?.targets || [])
        .filter((item: any) => item?.capability === props.capability && item?.provider_id && item?.enabled !== false)
        .sort((a: any, b: any) => Number(a.priority || 0) - Number(b.priority || 0))[0];
      const binding = defaultBinding || backup;
      const provider = providers.find((item: any) => item?.id === binding?.provider_id);
      configured.value = Boolean(provider && provider.enabled !== false);
      providerName.value = provider?.name || '';
      modelName.value = binding?.model || provider?.default_model || '';
    } catch (error: any) {
      errorText.value = error?.message || `无法读取${label.value}能力配置`;
      configured.value = false;
    }
  }

  function openModels() {
    router.push('/ai/models');
  }

  onMounted(load);
</script>

<style scoped>
  .ai-capability-status {
    margin-bottom: 16px;
  }
  .status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
  }
  .status-error {
    display: block;
    margin-top: 6px;
    font-size: 12px;
  }
</style>
