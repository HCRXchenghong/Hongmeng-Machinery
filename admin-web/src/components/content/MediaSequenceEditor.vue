<template>
  <div class="media-sequence-editor">
    <div v-if="items.length" class="media-sequence-list">
      <div v-for="(item, index) in items" :key="`${index}-${item.url}`" class="media-sequence-item">
        <div class="media-sequence-preview">
          <video v-if="item.type === 'video' && !isYouTube(item.url)" :src="item.url" muted playsinline />
          <div v-else-if="item.type === 'video'" class="media-sequence-youtube">YouTube</div>
          <img v-else :src="item.url" alt="" />
        </div>
        <div class="media-sequence-fields">
          <a-input v-model="item.url" placeholder="粘贴 HTTPS / 站内图片、视频或 YouTube 链接" allow-clear @change="publish" />
            <a-space wrap>
              <a-button size="small" :disabled="index === 0" @click="move(index, -1)">上移</a-button>
              <a-button size="small" :disabled="index === items.length - 1" @click="move(index, 1)">下移</a-button>
            <a-select v-model="item.type" size="small" style="width: 100px" @change="publish">
              <a-option value="image">照片</a-option>
              <a-option value="video">视频</a-option>
            </a-select>
            <a-checkbox v-if="item.type === 'video'" v-model="item.autoplay" @change="publish">自动播放</a-checkbox>
            <a-checkbox v-if="item.type === 'video'" v-model="item.muted" @change="publish">静音播放</a-checkbox>
            <a-button size="small" status="danger" @click="remove(index)">删除</a-button>
          </a-space>
          <span v-if="item.type === 'video' && isYouTube(item.url)" class="media-sequence-youtube-note">前台会显示 YouTube 跳转按钮</span>
        </div>
      </div>
    </div>
    <div class="media-sequence-add">
      <a-input v-model="draftUrl" placeholder="也可以直接输入图片、视频或 YouTube 链接" @press-enter="addDraft" />
      <a-select v-model="draftType" size="small" style="width: 100px">
        <a-option value="image">照片</a-option>
        <a-option value="video">视频</a-option>
      </a-select>
      <a-button type="primary" size="small" @click="addDraft">添加链接</a-button>
      <MediaPicker
        :model-value="pickerValue"
        :multiple="true"
        media-type=""
        accept="image/*,video/*"
        placeholder="从素材库选择或上传多张照片/视频"
        @update:model-value="addPicked"
        @uploaded="addUploaded"
      />
    </div>
    <details class="media-sequence-presets">
      <summary>选择宏盟机械原创生成素材</summary>
      <div>
        <button v-for="asset in generatedAssets" :key="asset.url" type="button" @click="add(asset.url, 'image')">
          <img :src="asset.url" :alt="asset.label" /><span>{{ asset.label }}</span>
        </button>
      </div>
    </details>
    <p class="media-sequence-help">支持多项自动轮播；视频可开启静音自动播放。YouTube 视频会提供“在 YouTube 上观看”按钮。</p>
  </div>
</template>

<script lang="ts" setup>
  import { ref, watch } from 'vue';
  import MediaPicker from './MediaPicker.vue';

  type MediaItem = { url: string; type: 'image' | 'video'; autoplay?: boolean; muted?: boolean; youtubeLink?: string };
  const props = defineProps<{ modelValue?: MediaItem[] }>();
  const emit = defineEmits<{ (e: 'update:modelValue', value: MediaItem[]): void }>();
  const items = ref<MediaItem[]>([]);
  const draftUrl = ref('');
  const draftType = ref<'image' | 'video'>('image');
  const pickerValue = ref('');
  const generatedAssets = [
    { url: '/assets/generated/solution-forestry.webp', label: '林地清理现场' },
    { url: '/assets/generated/solution-brush-clearing-v2.webp', label: '新增现场图：林地清理' },
    { url: '/assets/generated/solution-fence-line-v2.webp', label: '新增现场图：道路与围栏维护' },
    { url: '/assets/generated/solution-land-clearing.webp', label: '道路灌木清理' },
    { url: '/assets/generated/solution-woodland.webp', label: '林地设备作业' },
    { url: '/assets/generated/manufacturing-workshop.webp', label: '附件制造车间' },
    { url: '/assets/generated/manufacturing-assembly-v2.webp', label: '新增现场图：车间装配' },
    { url: '/assets/generated/attachment-detail.webp', label: '属具齿辊细节' },
    { url: '/assets/generated/product-mulcher-detail-v2.webp', label: '新增产品图：蓝色粉碎头' },
    { url: '/assets/generated/attachment-inspection.webp', label: '属具检验细节' },
    { url: '/assets/generated/home-hero.webp', label: '官网首屏设备图' },
    { url: '/assets/generated/product-hm38.webp', label: 'HM38 产品图' },
    { url: '/assets/generated/product-hm46.webp', label: 'HM46 产品图' },
    { url: '/assets/generated/product-teeth.webp', label: '替换刀齿图' }
  ];

  watch(() => props.modelValue, (value) => {
    items.value = Array.isArray(value) ? value.map((item: any): MediaItem => {
      if (typeof item === 'string') return { url: item, type: mediaType(item), autoplay: false, muted: true };
      const url = String(item?.url || item?.src || '');
      return { ...item, url, type: item?.type === 'video' ? 'video' : item?.type === 'image' ? 'image' : mediaType(url), autoplay: item?.autoplay === true, muted: item?.muted !== false };
    }).filter((item) => item.url) : [];
  }, { immediate: true, deep: true });

  function isYouTube(value: string) {
    try { return /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(new URL(value).hostname); } catch { return false; }
  }
  function mediaType(url: string, fallback: 'image' | 'video' = 'image'): 'image' | 'video' {
    return isYouTube(url) || /\.(mp4|webm|mov|m3u8|ogg)(?:$|[?#])/i.test(url) ? 'video' : fallback;
  }
  function publish() { emit('update:modelValue', items.value.map((item) => ({ ...item, url: item.url.trim() })).filter((item) => item.url)); }
  function add(url: string, type = draftType.value) {
    const clean = url.trim();
    if (!clean || items.value.some((item) => item.url === clean)) return;
    const inferred = mediaType(clean, type);
    items.value.push({ url: clean, type: inferred, autoplay: false, muted: true });
    publish();
  }
  function addDraft() { add(draftUrl.value); draftUrl.value = ''; }
  function addPicked(url: string) { add(url); pickerValue.value = ''; }
  function addUploaded(urls: string[]) { urls.forEach((url) => add(url, mediaType(url))); }
  function remove(index: number) { items.value.splice(index, 1); publish(); }
  function move(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= items.value.length) return;
    const [item] = items.value.splice(index, 1);
    items.value.splice(target, 0, item);
    publish();
  }
</script>

<style scoped lang="less">
  .media-sequence-editor { display: grid; gap: 10px; }
  .media-sequence-list { display: grid; gap: 9px; }
  .media-sequence-item { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 12px; padding: 10px; border: 1px solid var(--color-border-2); border-radius: 6px; }
  .media-sequence-preview { height: 82px; overflow: hidden; border-radius: 4px; background: var(--color-fill-2); }
  .media-sequence-preview img, .media-sequence-preview video { width: 100%; height: 100%; object-fit: cover; }
  .media-sequence-youtube { height: 100%; display: grid; place-items: center; color: var(--color-text-2); font-size: 13px; font-weight: 700; }
  .media-sequence-fields { min-width: 0; display: grid; align-content: center; gap: 8px; }
  .media-sequence-youtube-note { color: var(--color-text-3); font-size: 11px; }
  .media-sequence-add { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .media-sequence-add > .arco-input-wrapper { flex: 1 1 260px; }
  .media-sequence-help { margin: 0; color: var(--color-text-3); font-size: 12px; }
  .media-sequence-presets summary { color: rgb(var(--primary-6)); cursor: pointer; font-size: 12px; }
  .media-sequence-presets > div { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; padding-top: 9px; }
  .media-sequence-presets button { overflow: hidden; padding: 4px; border: 1px solid var(--color-border-2); border-radius: 5px; background: var(--color-bg-2); cursor: pointer; text-align: left; }
  .media-sequence-presets img { display: block; width: 100%; height: 66px; object-fit: cover; }
  .media-sequence-presets span { display: block; padding: 5px 2px 2px; color: var(--color-text-2); font-size: 11px; }
  @media (max-width: 600px) { .media-sequence-item { grid-template-columns: 82px minmax(0, 1fr); gap: 8px; padding: 7px; } .media-sequence-preview { height: 68px; } }
</style>
