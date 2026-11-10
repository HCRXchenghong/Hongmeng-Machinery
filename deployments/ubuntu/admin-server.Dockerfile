# 阶段一：安装全部依赖（含构建 admin-web 所需的 devDependencies）。
FROM node:24-alpine AS deps
# 国内 VPS 直连 registry.npmjs.org 会超时；部署脚本会按线路传入 NPM_REGISTRY。
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/package.json
COPY admin-web/package.json ./admin-web/package.json
# postinstall 需要 scripts/，缺失会让 npm ci 直接失败。
COPY scripts/ensure-rolldown-binding.mjs ./scripts/ensure-rolldown-binding.mjs
RUN npm config set registry "$NPM_REGISTRY" && npm ci --no-audit --no-fund

# 阶段二：构建 Arco Design Pro Vue 控制台。
FROM deps AS build-web
COPY admin-web ./admin-web
# 控制台需要官网的静态品牌资源（logo 等），一并拷入构建上下文。
COPY frontend/public ./frontend/public
RUN npm --workspace admin-web run build

# 阶段三：运行时只保留生产依赖与构建产物。
FROM node:24-alpine
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/package.json
COPY admin-web/package.json ./admin-web/package.json
COPY scripts/ensure-rolldown-binding.mjs ./scripts/ensure-rolldown-binding.mjs
RUN npm config set registry "$NPM_REGISTRY" && npm ci --omit=dev --no-audit --no-fund

COPY admin-server ./admin-server
COPY frontend ./frontend
COPY --from=build-web /app/admin-web/dist ./admin-web/dist
# 数据卷挂载点必须先于 chown 存在，否则新建命名卷归 root，appuser 无法写入。
RUN mkdir -p /app/data /app/uploads/site-admin \
  && adduser -D -H -u 1001 appuser \
  && chown -R appuser:appuser /app
USER appuser

ENV SITE_CONTENT_SEED_FILE=/app/admin-server/seed/site-content.json
EXPOSE 1337
CMD ["node", "admin-server/server.mjs"]
