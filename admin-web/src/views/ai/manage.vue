<template>
  <div class="ai-manage-page">
    <a-page-header :show-back="false" :title="sectionMeta.title" :subtitle="sectionMeta.subtitle" />
    <a-alert type="info" class="mb-4">{{ sectionMeta.hint }}</a-alert>

    <section v-if="section === 'models'" class="ai-section">
      <a-tabs v-model:active-key="modelTab" lazy-load type="line" size="large">
        <a-tab-pane key="providers" title="供应商与默认能力">
          <AiProvidersPanel />
        </a-tab-pane>
        <a-tab-pane key="backup" title="备用模型">
          <AiBindingsPanel />
        </a-tab-pane>
      </a-tabs>
    </section>
    <section v-else-if="section === 'reception'" class="ai-section"><AiReceptionPanel /></section>
    <section v-else-if="section === 'translation'" class="ai-section"><AiTranslationPanel /></section>
    <section v-else-if="section === 'image'" class="ai-section"><AiImagePanel /></section>
    <section v-else-if="section === 'limits'" class="ai-section"><AiLimitsPanel /></section>
  </div>
</template>

<script lang="ts" setup>
  import { computed, ref } from 'vue';
  import { useRoute } from 'vue-router';
  import AiProvidersPanel from './providers.vue';
  import AiReceptionPanel from './reception.vue';
  import AiTranslationPanel from './translation.vue';
  import AiImagePanel from './image.vue';
  import AiBindingsPanel from './bindings.vue';
  import AiLimitsPanel from './limits.vue';

  type AiSection = 'models' | 'reception' | 'translation' | 'image' | 'limits';
  const props = defineProps<{ section?: AiSection }>();

  const SECTION_META: Record<AiSection, { title: string; subtitle: string; hint: string }> = {
    models: { title: '模型配置', subtitle: '供应商、默认能力与备用模型', hint: '先在「供应商与默认能力」中为每种能力选择默认供应商；需要多供应商自动切换时，再到「备用模型」配置候选顺序。' },
    reception: { title: '接待 AI', subtitle: '接待提示词、知识库引用与回复策略', hint: '接待 AI 只负责生成建议或自动回复；访客转人工、黑名单和排队策略在「客服 → 服务策略」中配置。' },
    translation: { title: '翻译 AI', subtitle: '自动翻译开关、批次与超时', hint: '这里只维护翻译能力；翻译进度、语言版本和重译任务在「官网 → 多语言内容」中查看。' },
    image: { title: 'AI 生图', subtitle: '商品与场景图片生成', hint: '生成的图片先进入媒体素材库，确认后再用于商品或页面。' },
    limits: { title: '调用限额', subtitle: '访客、会话与 AI 调用频率上限', hint: '限额对所有 AI 能力生效；0 表示不限制。' }
  };

  const section = computed<AiSection>(() => props.section || 'models');
  const sectionMeta = computed(() => SECTION_META[section.value]);
  const route = useRoute();
  const modelTab = ref<'providers' | 'backup'>(route.query.tab === 'bindings' ? 'backup' : 'providers');
</script>

<style scoped>
  .ai-manage-page {
    min-height: calc(100vh - 100px);
  }
  .ai-section {
    display: block;
  }
</style>
