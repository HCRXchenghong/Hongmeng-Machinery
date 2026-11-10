#!/usr/bin/env bash
#
# 用生产的 Caddyfile 真跑一遍路由，验证三个域名各自的转发规则没被改坏。
#
# 做法：把 Caddyfile 里的容器上游临时替换成本机端口、TLS 换成内部 CA，
# 起一个临时 Caddy 容器，再用 curl --resolve 打三个域名。
# 只读仓库文件，所有临时产物都在 $TMPDIR，退出时清理。
#
# 前置：本机已跑着开发栈（scripts/run-local-stack.sh），端口 4331/1338/5175/8081。
#
# 用法：scripts/verify-caddy-routes.sh [--site-port 4331] [--admin-port 1338] [--service-port 5175] [--api-port 8081]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_PORT=4331
ADMIN_PORT=1338
SERVICE_PORT=5175
API_PORT=8081
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.8-alpine}"
HTTP_PORT="${CADDY_TEST_HTTP_PORT:-18080}"
HTTPS_PORT="${CADDY_TEST_HTTPS_PORT:-18443}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-port) SITE_PORT="$2"; shift 2 ;;
    --admin-port) ADMIN_PORT="$2"; shift 2 ;;
    --service-port) SERVICE_PORT="$2"; shift 2 ;;
    --api-port) API_PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "需要 docker" >&2; exit 1; }

# 工作目录必须放在仓库里：Docker 只挂载了仓库路径，$TMPDIR 在容器里看不到。
WORK_DIR="${CADDY_TEST_WORKDIR:-$ROOT_DIR/.caddy-routes-$$}"
mkdir -p "$WORK_DIR"
CONTAINER="hm-caddy-routes-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

python3 - "$ROOT_DIR" "$WORK_DIR" "$SITE_PORT" "$ADMIN_PORT" "$SERVICE_PORT" "$API_PORT" <<'PY'
import pathlib, sys
root, work, site, admin, service, api = sys.argv[1:7]
src = pathlib.Path(root, 'deployments/ubuntu/Caddyfile').read_text()
out = (src
       .replace('admin-server:1337', f'host.docker.internal:{admin}')
       .replace('frontend:80', f'host.docker.internal:{site}')
       .replace('servicebridge-user-web:80', f'host.docker.internal:{service}')
       .replace('servicebridge-backend-1:8080', f'host.docker.internal:{api}')
       .replace('servicebridge-backend-2:8080', f'host.docker.internal:{api}')
       .replace('s3:8333', 'host.docker.internal:58333')
       .replace("{\n\temail {$ACME_EMAIL}\n\tadmin off\n}", "{\n\temail {$ACME_EMAIL}\n\tadmin off\n\tlocal_certs\n}"))
pathlib.Path(work, 'Caddyfile').write_text(out)
PY

docker run -d --name "$CONTAINER" \
  -p "127.0.0.1:${HTTP_PORT}:80" -p "127.0.0.1:${HTTPS_PORT}:443" \
  --add-host=host.docker.internal:host-gateway \
  -e SITE_DOMAIN=www.caddy-check.local \
  -e ADMIN_DOMAIN=admin.caddy-check.local \
  -e SERVICE_DOMAIN=service.caddy-check.local \
  -e ACME_EMAIL=ops@caddy-check.local \
  -v "$WORK_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" >/dev/null

# 等证书签发完成（内部 CA 很快，但要防慢机器）
for _ in $(seq 1 30); do
  if curl -sk -o /dev/null --max-time 2 --resolve "www.caddy-check.local:${HTTPS_PORT}:127.0.0.1" "https://www.caddy-check.local:${HTTPS_PORT}/"; then
    break
  fi
  sleep 1
done

RESOLVE=(
  --resolve "www.caddy-check.local:${HTTPS_PORT}:127.0.0.1"
  --resolve "admin.caddy-check.local:${HTTPS_PORT}:127.0.0.1"
  --resolve "service.caddy-check.local:${HTTPS_PORT}:127.0.0.1"
)
FAIL=0
check() {
  local label="$1" expect="$2"; shift 2
  local code
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "${RESOLVE[@]}" "$@")"
  if [[ "$code" == "$expect" ]]; then
    printf '  [ OK ] %-34s %s\n' "$label" "$code"
  else
    printf '  [FAIL] %-34s 期望 %s，实际 %s\n' "$label" "$expect" "$code"
    FAIL=1
  fi
}

echo "== 官网域名 =="
check "首页 → 前台" 200 "https://www.caddy-check.local:${HTTPS_PORT}/"
check "robots.txt → 前台" 200 "https://www.caddy-check.local:${HTTPS_PORT}/robots.txt"
check "sitemap-products.xml → 后台" 200 "https://www.caddy-check.local:${HTTPS_PORT}/sitemap-products.xml"
check "404 页 → 前台" 404 "https://www.caddy-check.local:${HTTPS_PORT}/no-such-page/"

echo "== 后台域名 =="
check "site-admin → 后台" 200 "https://admin.caddy-check.local:${HTTPS_PORT}/site-admin/"
check "媒体路径 → S3 网关" 200 "https://admin.caddy-check.local:${HTTPS_PORT}/hongmeng-site-media/"

echo "== 客服域名 =="
check "嵌入页 → 客服前端" 200 "https://service.caddy-check.local:${HTTPS_PORT}/?embed=1"
check "/api 未授权 → 引擎 401" 401 -X POST -H 'content-type: application/json' -d '{}' "https://service.caddy-check.local:${HTTPS_PORT}/api/admin/login"

echo "== 安全响应头 =="
HDR="$(curl -sk -D - -o /dev/null --max-time 10 "${RESOLVE[@]}" "https://www.caddy-check.local:${HTTPS_PORT}/")"
for header in content-security-policy strict-transport-security x-content-type-options; do
  if grep -qi "^${header}:" <<<"$HDR"; then
    printf '  [ OK ] %s\n' "$header"
  else
    printf '  [FAIL] 缺少 %s\n' "$header"
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "路由校验失败" >&2
  exit 1
fi
echo "路由校验通过"
