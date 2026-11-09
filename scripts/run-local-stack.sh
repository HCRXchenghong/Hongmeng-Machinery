#!/usr/bin/env zsh
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.local-logs"
mkdir -p "$LOG_DIR"

# --lan：把四个端口映射到本机局域网 IP，手机/同网段电脑可直接访问。
LAN_MODE=0
for arg in "$@"; do
  case "$arg" in
    --lan) LAN_MODE=1 ;;
    --help|-h) printf '用法: %s [--lan]\n  --lan  绑定 0.0.0.0 并用局域网 IP 生成公开地址\n' "$0"; exit 0 ;;
  esac
done

detect_lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    local iface
    for iface in en0 en1 en2; do
      local ip
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      [[ -n "$ip" ]] && { printf '%s' "$ip"; return 0; }
    done
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' && return 0
  fi
  return 1
}

cd "$ROOT_DIR"

bash "$ROOT_DIR/scripts/start-local-storage.sh"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

# 每次本地启动都构建最新的控制台，避免旧 dist 留下旧品牌或旧路由。
printf '[hongmeng] building Arco admin console...\n'
(cd "$ROOT_DIR" && npm --workspace admin-web run build >"$LOG_DIR/admin-build.log" 2>&1) || {
  printf '[hongmeng] admin console build failed，查看 %s/admin-build.log\n' "$LOG_DIR" >&2
  exit 1
}

if (( LAN_MODE == 1 )); then
  LAN_IP="$(detect_lan_ip || true)"
  if [[ -z "${LAN_IP:-}" ]]; then
    printf '[hongmeng] 取不到局域网 IP，先确认已连上 Wi-Fi/网线。\n' >&2
    exit 1
  fi
  LAN_BASE="http://$LAN_IP"
  # 绑定所有网卡；公开地址统一换成局域网 IP，前端构建期也会写入这套地址。
  export HOST=0.0.0.0
  export FRONTEND_HOST=0.0.0.0
  export PUBLIC_SITE_URL="$LAN_BASE:4331"
  export PUBLIC_ADMIN_URL="$LAN_BASE:1338"
  export PUBLIC_ADMIN_ORIGIN="$LAN_BASE:1338"
  export PUBLIC_LEADS_ENDPOINT="$LAN_BASE:1338/site-admin-api/leads"
  export PUBLIC_SERVICEBRIDGE_URL="$LAN_BASE:5175"
  export PUBLIC_SERVICEBRIDGE_API_URL="$LAN_BASE:8081"
  export ADMIN_CORS_ALLOWED_ORIGINS="$LAN_BASE:4331,$LAN_BASE:1338,http://127.0.0.1:4331,http://localhost:4331,http://localhost:1338"
  export SERVICEBRIDGE_CORS_ALLOWED_ORIGINS="$LAN_BASE:4331,$LAN_BASE:5175,http://127.0.0.1:4331,http://127.0.0.1:5175"
  export CORS_ALLOWED_ORIGINS="$SERVICEBRIDGE_CORS_ALLOWED_ORIGINS"
  export FRAME_ANCESTORS="$LAN_BASE:4331,http://127.0.0.1:4331"
  printf '[hongmeng] 局域网模式：%s\n' "$LAN_BASE"
fi

export PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-http://127.0.0.1:4331}"
export PUBLIC_ADMIN_URL="${PUBLIC_ADMIN_URL:-http://127.0.0.1:1338}"
export PUBLIC_LEADS_ENDPOINT="${PUBLIC_LEADS_ENDPOINT:-$PUBLIC_ADMIN_URL/site-admin-api/leads}"
# 控制台自身（1338）与 Vite 开发服务器（5176）也要在允许来源里。
export ADMIN_CORS_ALLOWED_ORIGINS="${ADMIN_CORS_ALLOWED_ORIGINS:-$PUBLIC_SITE_URL,http://127.0.0.1:1338,http://127.0.0.1:5176}"
export PUBLIC_SERVICEBRIDGE_URL="${PUBLIC_SERVICEBRIDGE_URL:-http://127.0.0.1:5175}"
export SERVICEBRIDGE_CORS_ALLOWED_ORIGINS="${SERVICEBRIDGE_CORS_ALLOWED_ORIGINS:-http://127.0.0.1:4331,http://127.0.0.1:5175}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-$SERVICEBRIDGE_CORS_ALLOWED_ORIGINS}"
export FRAME_ANCESTORS="${FRAME_ANCESTORS:-http://127.0.0.1:4331}"

# 引擎默认走 PostgreSQL：AI 供应商、能力绑定、故障转移候选链、会话/消息都必须持久化，
# 内存驱动一重启就全丢（历史上本地栈用 `env -u DATABASE_URL` 强制内存，这里已修正）。
export STORE_DRIVER="${STORE_DRIVER:-postgres}"
if [[ "$STORE_DRIVER" != "postgres" ]]; then
  printf '[hongmeng] 警告：STORE_DRIVER=%s，AI 供应商/绑定不会持久化，重启即丢。\n' "$STORE_DRIVER" >&2
fi

# 引擎用独立库（默认从 CMS 的 DATABASE_URL 换库名推导），可用 SERVICEBRIDGE_DATABASE_URL 覆盖。
if [[ -z "${SERVICEBRIDGE_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
  _db_base="${DATABASE_URL%%\?*}"
  _db_query="${DATABASE_URL#"$_db_base"}"
  SERVICEBRIDGE_DATABASE_URL="${_db_base%/*}/hongmeng_engine${_db_query}"
fi
export SERVICEBRIDGE_DATABASE_URL="${SERVICEBRIDGE_DATABASE_URL:-}"
if [[ "$STORE_DRIVER" == "postgres" && -z "$SERVICEBRIDGE_DATABASE_URL" ]]; then
  printf '[hongmeng] STORE_DRIVER=postgres 但缺少 SERVICEBRIDGE_DATABASE_URL（或 DATABASE_URL），无法启动引擎。\n' >&2
  exit 1
fi

# AI 供应商 API Key 以密文入库，密钥丢失/更换会导致已存 Key 无法解密，因此首次生成后写回 .env 固定下来。
if [[ -z "${DATA_ENCRYPTION_KEY:-}" || ${#DATA_ENCRYPTION_KEY} -lt 32 ]]; then
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    printf '[hongmeng] 缺少 .env，无法持久化 DATA_ENCRYPTION_KEY。\n' >&2
    exit 1
  fi
  DATA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  printf '\n# 由 scripts/run-local-stack.sh 自动生成：加密 AI 供应商 API Key（≥32 字符，切勿更换）。\nDATA_ENCRYPTION_KEY=%s\n' \
    "$DATA_ENCRYPTION_KEY" >>"$ROOT_DIR/.env"
  printf '[hongmeng] 已生成并写入 .env 的 DATA_ENCRYPTION_KEY（用于 AI API Key 加密入库）。\n'
fi
export DATA_ENCRYPTION_KEY

export HTTP_ADDR="${HTTP_ADDR:-0.0.0.0:8081}"
# 受限沙箱（以及部分 CI）禁止写默认的 ~/Library/Caches/go-build；把 Go 构建缓存放到可写目录。
export GOCACHE="${GOCACHE:-${TMPDIR:-/tmp}/hongmeng-go-cache}"
mkdir -p "$GOCACHE"

pids=()

start_service() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/$name.log"
  printf '[hongmeng] starting %s -> %s\n' "$name" "$log_file"
  (
    cd "$ROOT_DIR"
    "$@"
  ) >"$log_file" 2>&1 &
  pids+=("$!")
}

cleanup() {
  printf '\n[hongmeng] stopping local stack...\n'
  for pid in "${pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}

trap cleanup INT TERM EXIT

start_service admin npm run dev:admin
for _ in {1..30}; do
  if curl -fsS "$PUBLIC_ADMIN_URL/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS "$PUBLIC_ADMIN_URL/healthz" >/dev/null 2>&1; then
  printf '[hongmeng] 后台启动失败，查看 %s/admin.log\n' "$LOG_DIR" >&2
  exit 1
fi
printf '[hongmeng] 构建官网静态页面...\n'
npm run build:frontend >"$LOG_DIR/frontend-build.log" 2>&1 || {
  printf '[hongmeng] 官网构建失败，查看 %s/frontend-build.log\n' "$LOG_DIR" >&2
  exit 1
}
start_service frontend-static node scripts/static-server.mjs
start_service rebuild-webhook npm run rebuild:webhook
start_service servicebridge-backend env DATABASE_URL="$SERVICEBRIDGE_DATABASE_URL" STORE_DRIVER="$STORE_DRIVER" DATA_ENCRYPTION_KEY="$DATA_ENCRYPTION_KEY" HTTP_ADDR="$HTTP_ADDR" CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS" FRAME_ANCESTORS="$FRAME_ANCESTORS" npm run servicebridge:backend
start_service servicebridge-user-web python3 -m http.server ${SERVICEBRIDGE_USER_WEB_PORT:-5175} --bind 0.0.0.0 --directory "$ROOT_DIR/servicebridge/apps/user-web"

printf '[hongmeng] local stack launched. Logs are in %s\n' "$LOG_DIR"
printf '[hongmeng] engine store: %s\n' "$STORE_DRIVER"
printf '[hongmeng] frontend: %s/\n' "$PUBLIC_SITE_URL"
printf '[hongmeng] admin login: %s/site-admin/login\n' "$PUBLIC_ADMIN_URL"
printf '[hongmeng] site admin: %s/site-admin/\n' "$PUBLIC_ADMIN_URL"
printf '[hongmeng] admin dev (HMR): npm run dev:admin-web  # http://127.0.0.1:5176/site-admin/\n'
# 独立打开访客端要带 api_base，否则它会按惯例猜 8080 端口。
printf '[hongmeng] servicebridge user web: %s/?api_base=%s\n' \
  "$PUBLIC_SERVICEBRIDGE_URL" "${PUBLIC_SERVICEBRIDGE_API_URL:-http://127.0.0.1:8081}"
printf '[hongmeng] servicebridge api: %s/healthz\n' "${PUBLIC_SERVICEBRIDGE_API_URL:-http://127.0.0.1:8081}"

# Keep this supervisor alive; otherwise EXIT would stop every service immediately.
wait "${pids[@]}"

while true; do
  sleep 3600
done
