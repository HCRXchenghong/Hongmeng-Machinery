<template>
  <a-card :bordered="false" class="media-page">
    <template #title>
      <a-space>
        <span>媒体素材</span>
        <a-tag :color="storageTagColor">{{ storageTagText }}</a-tag>
      </a-space>
    </template>
    <template #extra>
      <a-space wrap :size="8">
        <a-button size="small" @click="categoryVisible = true">分类管理</a-button>
        <a-button size="small" type="primary" @click="uploadVisible = true">上传素材</a-button>
        <a-button size="small" @click="openDrawer('settings')">存储设置</a-button>
        <a-button size="small" @click="openDrawer('guide')">接入指南</a-button>
        <a-button size="small" :loading="refreshing" @click="refreshCurrent">刷新</a-button>
      </a-space>
    </template>

    <a-alert v-if="initError" type="error" class="init-error">
      <template #title>素材数据加载失败</template>
      {{ initError }}
      <a-link class="retry-link" @click="initialize">重试</a-link>
    </a-alert>

    <MediaGallery
      ref="galleryRef"
      :categories="categories"
      :stats-total="Number(stats.total || 0)"
      :settings="settings"
      @changed="onGalleryChanged"
    />

    <MediaUploadModal
      v-model:visible="uploadVisible"
      :categories="categories"
      :settings="settings"
      @uploaded="onUploaded"
    />

    <MediaCategoryModal
      v-model:visible="categoryVisible"
      :categories="categories"
      @changed="onCategoriesChanged"
    />

    <a-drawer
      v-model:visible="drawerVisible"
      :width="720"
      :title="drawerTitle"
      :footer="false"
      unmount-on-close
    >
      <MediaSettingsPanel
        v-if="drawerKind === 'settings'"
        :settings="settings"
        :runtime="runtime"
        :stats="stats"
        :loading="loadingSettings"
        :error="settingsError"
        @saved="loadSettings"
      />
      <MediaGuide v-else />
    </a-drawer>
  </a-card>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import { fetchMediaCategories, fetchMediaRuntime, fetchMediaSettings, fetchMediaStats } from '@/api/media';
  import type { MediaCategory, MediaRuntime, MediaSettings, MediaStats } from '@/api/media';
  import MediaGallery from '@/components/media/MediaGallery.vue';
  import MediaUploadModal from '@/components/media/MediaUploadModal.vue';
  import MediaCategoryModal from '@/components/media/MediaCategoryModal.vue';
  import MediaSettingsPanel from '@/components/media/MediaSettingsPanel.vue';
  import MediaGuide from '@/components/media/MediaGuide.vue';

  const stats = ref<MediaStats>({});
  const runtime = ref<MediaRuntime>({});
  const categories = ref<MediaCategory[]>([]);
  const settings = ref<MediaSettings | null>(null);
  const loadingSettings = ref(false);
  const refreshing = ref(false);
  const initError = ref('');
  const settingsError = ref('');
  const uploadVisible = ref(false);
  const categoryVisible = ref(false);
  const galleryRef = ref<InstanceType<typeof MediaGallery> | null>(null);

  const drawerVisible = ref(false);
  const drawerKind = ref<'settings' | 'guide'>('settings');
  const drawerTitle = computed(() => (drawerKind.value === 'settings' ? '存储设置' : '存储接入指南'));

  const storage = computed(() => stats.value.storage || runtime.value.storage || {});
  const storageTagText = computed(() => {
    if (storage.value.ok === undefined) return '存储检查中';
    return storage.value.ok ? `${storage.value.bucket || 'S3'} 已连通` : '存储连接异常';
  });
  const storageTagColor = computed(() => {
    if (storage.value.ok === undefined) return 'gray';
    return storage.value.ok ? 'green' : 'red';
  });

  async function loadStats() {
    stats.value = (await fetchMediaStats()).data || {};
  }
  async function loadRuntime() {
    runtime.value = (await fetchMediaRuntime()).data || {};
  }
  async function loadCategories() {
    categories.value = (await fetchMediaCategories()).data || [];
  }
  async function loadSettings() {
    settings.value = (await fetchMediaSettings()).data || null;
  }

  async function initialize() {
    initError.value = '';
    settingsError.value = '';
    const results = await Promise.allSettled([loadStats(), loadRuntime(), loadCategories(), loadSettings()]);
    const failed = results.slice(0, 3).find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) {
      initError.value = failed.reason?.response?.data?.error?.message || failed.reason?.message || '部分素材数据加载失败。';
    }
    const settingsFailure = results[3] as PromiseSettledResult<unknown>;
    if (settingsFailure.status === 'rejected') {
      settingsError.value =
        (settingsFailure.reason as any)?.response?.data?.error?.message ||
        (settingsFailure.reason as any)?.message ||
        '存储配置加载失败。';
    }
  }

  function openDrawer(kind: 'settings' | 'guide') {
    drawerKind.value = kind;
    drawerVisible.value = true;
    if (kind === 'settings') {
      loadingSettings.value = true;
      Promise.allSettled([loadSettings(), loadRuntime()]).finally(() => {
        loadingSettings.value = false;
      });
    }
  }

  async function refreshCurrent() {
    refreshing.value = true;
    try {
      await Promise.allSettled([loadStats(), loadCategories(), galleryRef.value?.reload()]);
      if (drawerVisible.value && drawerKind.value === 'settings') {
        await Promise.allSettled([loadSettings(), loadRuntime()]);
      }
    } finally {
      refreshing.value = false;
    }
  }

  async function afterMutation() {
    await Promise.allSettled([loadStats(), loadCategories(), galleryRef.value?.reload()]);
  }

  function onUploaded() {
    void afterMutation();
  }
  function onGalleryChanged() {
    void Promise.allSettled([loadStats(), loadCategories()]);
  }
  function onCategoriesChanged() {
    void afterMutation();
  }

  onMounted(initialize);
</script>

<style scoped>
  .media-page :deep(.arco-card-header) {
    border-bottom: none;
  }
  .init-error {
    margin-bottom: 12px;
  }
  .retry-link {
    margin-left: 8px;
  }
</style>
