FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/package.json
# postinstall 需要该脚本，缺失会让 npm ci 直接失败。
COPY scripts/ensure-rolldown-binding.mjs ./scripts/ensure-rolldown-binding.mjs
RUN npm ci --no-audit --no-fund

COPY scripts ./scripts
COPY frontend ./frontend
COPY admin-server ./admin-server
RUN chmod +x /app/scripts/rebuild-entrypoint.sh

ENTRYPOINT ["/app/scripts/rebuild-entrypoint.sh"]
