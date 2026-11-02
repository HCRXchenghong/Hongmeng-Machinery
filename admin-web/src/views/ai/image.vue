<template>
  <div class="ai-image-page">
    <AiCapabilityStatus capability="image" />
    <MediaAiWorkbench
      :categories="categories"
      :settings="settings"
      @changed="onGenerated"
    />
  </div>
</template>

<script lang="ts" setup>
  import { onMounted, ref } from 'vue';
  import type { MediaCategory, MediaSettings } from '@/api/media';
  import { fetchMediaCategories, fetchMediaSettings } from '@/api/media';
  import MediaAiWorkbench from '@/components/media/MediaAiWorkbench.vue';
  import AiCapabilityStatus from '@/components/ai/AiCapabilityStatus.vue';

  const categories = ref<MediaCategory[]>([]);
  const settings = ref<MediaSettings | null>(null);

  async function loadSettings() {
    settings.value = (await fetchMediaSettings()).data || null;
  }

  async function onGenerated() {
    await loadSettings();
  }

  onMounted(async () => {
    const [categoryPayload] = await Promise.allSettled([fetchMediaCategories(), loadSettings()]);
    if (categoryPayload.status === 'fulfilled') {
      categories.value = (categoryPayload.value as { data?: MediaCategory[] }).data || [];
    }
  });
</script>

<style scoped>
  .ai-image-page {
    min-height: calc(100vh - 120px);
  }
</style>
