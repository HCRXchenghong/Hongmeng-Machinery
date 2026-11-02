<template>
  <div class="seo-page">
    <div class="seo-head">
      <div>
        <a-typography-title :heading="4" class="seo-title">SEO 设置</a-typography-title>
        <a-typography-text type="secondary">
          每个页面独立维护标题、描述、关键词与分享图；AI 只生成草稿，保存前可以逐项人工修改。
        </a-typography-text>
      </div>
      <a-space wrap>
        <a-button :loading="loading" @click="load">刷新</a-button>
        <a-button type="primary" :loading="generating" @click="generate">AI 生成 SEO</a-button>
        <a-button type="primary" :loading="saving" @click="save">保存 SEO</a-button>
      </a-space>
    </div>

    <AiCapabilityStatus capability="seo" />

    <a-alert type="info" class="seo-tip">
      AI 会根据当前中文官网内容和商品资料生成中文 SEO；英文、阿拉伯语随后进入翻译队列。
      标题不要包含品牌名，前台会自动追加“ | Hongmeng Machinery”。
    </a-alert>

    <div class="seo-layout">
      <aside class="seo-nav">
        <strong>页面</strong>
        <button
          v-for="page in pages"
          :key="page.key"
          type="button"
          :class="{ active: activeKey === page.key }"
          @click="activeKey = page.key"
        >
          <span>{{ page.label }}</span>
          <small>{{ page.path }}</small>
        </button>
      </aside>

      <section v-if="current" class="seo-editor">
        <a-card :bordered="false" :title="`${current.label} · ${current.path}`">
          <a-alert v-if="current.key === 'product'" type="info" class="product-template-tip">
            商品详情模板可使用占位符 {name}、{category}、{sku}、{summary}；标题不含 {name} 时前台会回退商品名称。
          </a-alert>
          <a-form layout="vertical">
            <a-form-item label="SEO 标题">
              <a-input
                v-model="current.title"
                :max-length="70"
                show-word-limit
                placeholder="例如：工程机械属具与林业粉碎机配件"
              />
            </a-form-item>
            <a-form-item label="SEO 描述">
              <a-textarea
                v-model="current.description"
                :max-length="180"
                :auto-size="{ minRows: 3, maxRows: 6 }"
                show-word-limit
                placeholder="用一句到两句话说明页面内容、适用设备与采购价值。"
              />
            </a-form-item>
            <a-form-item label="关键词">
              <a-input
                v-model="current.keywords"
                :max-length="300"
                show-word-limit
                placeholder="工程机械属具, 林业粉碎机, 替换配件"
              />
              <template #extra>用英文逗号分隔，建议 4–8 个，不要堆砌。</template>
            </a-form-item>
            <a-form-item label="分享图（Open Graph）">
              <MediaPicker v-model="current.image" media-type="image" accept="image/*" />
              <template #extra>留空时使用商品图或首页主图。</template>
            </a-form-item>
          </a-form>

          <a-divider orientation="left">搜索结果预览</a-divider>
          <div class="seo-preview">
            <div class="seo-preview-url">hongmengmachinery.com{{ current.path }}</div>
            <div class="seo-preview-title">{{ previewTitle }}</div>
            <div class="seo-preview-desc">{{ current.description || '填写描述后在这里预览搜索结果摘要。' }}</div>
          </div>
        </a-card>
      </section>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import {
    generateStorefrontSeo,
    getStorefrontSeo,
    updateStorefrontSeo,
    type StorefrontSeoPage,
  } from '@/api/commerce';
  import AiCapabilityStatus from '@/components/ai/AiCapabilityStatus.vue';
  import MediaPicker from '@/components/content/MediaPicker.vue';

  type SeoPage = StorefrontSeoPage & { key: string; label: string; path: string };

  const PAGE_DEFS = [
    { key: 'home', label: '首页', path: '/' },
    { key: 'about', label: '关于我们', path: '/about/' },
    { key: 'solutions', label: '应用方案', path: '/solutions/' },
    { key: 'shop', label: '商品列表', path: '/shop/' },
    { key: 'product', label: '商品详情（模板）', path: '/shop/product/' },
    { key: 'contact', label: '联系我们', path: '/contact/' },
    { key: 'news', label: '新闻动态', path: '/news/' },
    { key: 'shipping', label: '配送政策', path: '/shipping/' },
    { key: 'returns', label: '退货与退款', path: '/returns/' },
    { key: 'privacy', label: '隐私政策', path: '/privacy/' },
    { key: 'terms', label: '销售条款', path: '/terms/' },
    { key: 'cookies', label: 'Cookie 政策', path: '/cookies/' },
    { key: 'cart', label: '购物车与结账', path: '/cart/' },
    { key: 'not-found', label: '404 页面', path: '/404/' },
  ] as const;

  const loading = ref(false);
  const saving = ref(false);
  const generating = ref(false);
  const activeKey = ref('home');
  const pages = ref<SeoPage[]>(
    PAGE_DEFS.map((page) => ({ ...page, title: '', description: '', keywords: '', image: '' }))
  );

  const current = computed(() => pages.value.find((page) => page.key === activeKey.value) || pages.value[0]);
  const previewTitle = computed(() => {
    const title = current.value?.title?.trim();
    return title ? `${title} | Hongmeng Machinery` : '标题会显示在这里 | Hongmeng Machinery';
  });

  function applySeo(data: { pages?: Record<string, StorefrontSeoPage> } | null) {
    const source = data?.pages || {};
    pages.value = PAGE_DEFS.map((page) => ({
      ...page,
      title: source[page.key]?.title || '',
      description: source[page.key]?.description || '',
      keywords: source[page.key]?.keywords || '',
      image: source[page.key]?.image || '',
    }));
  }

  async function load() {
    loading.value = true;
    try {
      applySeo(await getStorefrontSeo());
    } catch (error: any) {
      Message.error(error?.response?.data?.error?.message || error?.message || 'SEO 加载失败');
    } finally {
      loading.value = false;
    }
  }

  async function save() {
    saving.value = true;
    try {
      const seo = {
        pages: Object.fromEntries(
          pages.value.map((page) => [
            page.key,
            {
              title: page.title.trim(),
              description: page.description.trim(),
              keywords: page.keywords.trim(),
              image: page.image.trim(),
            },
          ])
        ),
      };
      applySeo(await updateStorefrontSeo(seo));
      Message.success('SEO 已保存；英文、阿拉伯语会进入翻译队列');
    } catch (error: any) {
      Message.error(error?.response?.data?.error?.message || error?.message || 'SEO 保存失败');
    } finally {
      saving.value = false;
    }
  }

  async function generate() {
    generating.value = true;
    try {
      const result = await generateStorefrontSeo();
      applySeo(result.data);
      Message.success(`AI 已生成 ${result.meta?.generated || 0} 个页面，请检查后保存`);
    } catch (error: any) {
      Message.error(error?.response?.data?.error?.message || error?.message || 'AI 生成失败');
    } finally {
      generating.value = false;
    }
  }

  onMounted(load);
</script>

<style scoped>
  .seo-page {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .seo-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .seo-title {
    margin: 0 0 4px;
  }
  .seo-tip {
    margin-bottom: 0;
  }
  .seo-layout {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .seo-nav {
    position: sticky;
    top: 84px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 14px;
    border: 1px solid var(--color-border-2);
    border-radius: 8px;
    background: var(--color-bg-2);
  }
  .seo-nav strong {
    margin-bottom: 6px;
    color: var(--color-text-2);
    font-size: 12px;
    letter-spacing: .08em;
  }
  .seo-nav button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 0;
    border-radius: 6px;
    padding: 7px 9px;
    background: transparent;
    color: var(--color-text-1);
    text-align: left;
    cursor: pointer;
  }
  .seo-nav button:hover { background: var(--color-fill-2); }
  .seo-nav button.active { background: rgb(var(--primary-1)); color: rgb(var(--primary-6)); }
  .seo-nav small { color: var(--color-text-3); font-size: 11px; }
  .product-template-tip {
    margin-bottom: 16px;
  }
  .seo-preview {
    max-width: 620px;
    padding: 14px 16px;
    border: 1px solid var(--color-border-2);
    border-radius: 8px;
    background: var(--color-bg-2);
  }
  .seo-preview-url { color: #3c7a3c; font-size: 12px; }
  .seo-preview-title { margin-top: 4px; color: #1a0dab; font-size: 18px; line-height: 1.35; }
  .seo-preview-desc { margin-top: 4px; color: var(--color-text-2); font-size: 13px; line-height: 1.6; }
  @media (max-width: 900px) {
    .seo-layout { grid-template-columns: 1fr; }
    .seo-nav { position: static; flex-direction: row; flex-wrap: wrap; }
  }
</style>
