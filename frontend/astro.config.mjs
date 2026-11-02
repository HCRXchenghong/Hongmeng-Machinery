import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const env = loadEnv(process.env.NODE_ENV || 'development', workspaceRoot, '');
const site = process.env.PUBLIC_SITE_URL || env.PUBLIC_SITE_URL || 'http://127.0.0.1:4331';

export default defineConfig({
  site,
  output: 'static',
  integrations: [
    react(),
    sitemap({ filter: (page) => {
      const pathname = new URL(page).pathname;
      return !/(?:^|\/)404(?:\/|$|\.html$)/.test(pathname) && !/(?:^|\/)(?:account|cart)(?:\/|$)/.test(pathname) && !/(?:^|\/)shop\/product\/$/.test(pathname);
    } })
  ],
  // Tailwind CSS v4 走 Vite 插件，不再需要 postcss/tailwind 配置文件。
  vite: {
    // 与 admin-server 共用仓库根目录的 .env，确保 PUBLIC_* 变量在构建期注入前端。
    envDir: workspaceRoot,
    plugins: [tailwindcss()]
  }
});
