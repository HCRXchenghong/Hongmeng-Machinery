import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { vitePluginForArco } from '@arco-plugins/vite-vue';
import path from 'node:path';

// 后台 SPA 与 admin-server 同源：生产由 /site-admin/ 提供，开发时把 API 代理到 1337。
// vueJsx 是必需的：Arco Pro 的菜单组件用 <script lang="tsx"> 编写。
export default defineConfig({
  base: '/site-admin/',
  plugins: [
    vue(),
    vueJsx(),
    vitePluginForArco({
      style: 'less',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5176,
    proxy: {
      '/site-admin-api': 'http://127.0.0.1:1338',
      '/site-admin-auth': 'http://127.0.0.1:1338',
      '/openapi.json': 'http://127.0.0.1:1338',
      // 商品图片库由官网 public/ 统一提供，HMR 管理台也复用同一份原创素材。
      '/assets': 'http://127.0.0.1:1338',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
