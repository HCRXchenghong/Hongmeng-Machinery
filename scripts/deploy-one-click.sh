#!/usr/bin/env bash
# 宏盟机械独立站一键部署（Ubuntu / Debian）
#
# 整段复制粘贴即可执行：
#   curl -fsSL https://raw.githubusercontent.com/HCRXchenghong/Hongmeng-Machinery/main/scripts/deploy-one-click.sh | sudo bash
#
# 行为概述：
#   1. 体检本机环境（系统、架构、CPU/内存/磁盘、端口、时钟、DNS）；
#   2. 对 apt 源、Docker 镜像、代码下载做多线路测速，按最快线路走直连或镜像；
#   3. 自动补齐或升级 Docker Engine 与 compose 插件；
#   4. 拉取代码；已有老版本则原地升级，只重建容器，数据卷与配置文件原样保留；
#   5. 询问域名，由 Caddy 自动签发 Let's Encrypt 证书并自动续期；
#   6. 全量健康检查（前台/后台/客服/接口/证书/容器），全部正常才以 0 退出。
#
# 常用参数：
#   --domain www.example.com --admin-domain admin.example.com --service-domain service.example.com
#   --email ops@example.com        证书通知邮箱
#   --dir /opt/hongmeng-machinery  安装目录
#   --ref v1.0.1                   指定版本（默认 main）
#   --yes                          全程不询问（须同时给出域名与邮箱）
#   --monitoring                   同时启用 Prometheus + Grafana（仅回环）
#   --no-backup                    升级前不做数据库备份
#   --rollback                     回滚到上一个成功版本
#   --check                        只体检，不部署
#   --token <PAT>                  私有仓库访问令牌（公开仓库可省，或用 HONGMENG_TOKEN）
#   --skip-docker-install          跳过 Docker 安装（要求已具备）

set -Eeuo pipefail

readonly REPO_SLUG="HCRXchenghong/Hongmeng-Machinery"
readonly REPO_URL="https://github.com/${REPO_SLUG}.git"
readonly RAW_SCRIPT="https://raw.githubusercontent.com/${REPO_SLUG}/main/scripts/deploy-one-click.sh"
readonly STACK_NAME="hongmeng-machinery"
readonly MEDIA_BUCKET="hongmeng-site-media"
readonly MEDIA_ACCESS_KEY="hongmeng-media"
readonly MIN_MEM_MB=1900
readonly MIN_DISK_GB=12
readonly MIN_CPU=2
readonly MIN_ENGINE_MAJOR=24
readonly MIN_COMPOSE_MINOR="2.20"
readonly MAX_TESTED_ENGINE_MAJOR=28

INSTALL_DIR="${HONGMENG_DIR:-/opt/hongmeng-machinery}"
TOKEN="${HONGMENG_TOKEN:-${GITHUB_TOKEN:-}}"
TARGET_REF=""
SITE_DOMAIN="${SITE_DOMAIN:-}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
SERVICE_DOMAIN="${SERVICE_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
ASSUME_YES=0
ENABLE_MONITORING=0
DO_BACKUP=1
DO_ROLLBACK=0
CHECK_ONLY=0
SKIP_DOCKER_INSTALL=0
MIRROR_APT=""
MIRROR_GH=""
PUBLIC_IP=""
HAD_INSTALL=0
APT_OPTS=()
# 允许用 HONGMENG_CURL_OPTS（如 "-k"）追加 curl 参数。
# shellcheck disable=SC2206
CURL_OPTS=(${HONGMENG_CURL_OPTS:-})
COMPOSE_PROFILE=()

DEPLOY_DIR=""
ENV_FILE=""
STATE_DIR=""
LOG_FILE=""
CRED_FILE=""

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_BOLD=""
fi

log()  { printf '%s[%s]%s %s\n' "$C_INFO" "$(date +%H:%M:%S)" "$C_RESET" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$C_OK" "$C_RESET" "$*"; }
warn() { printf '%s  ! %s%s\n' "$C_WARN" "$*" "$C_RESET"; }
step() { printf '\n%s==>%s %s%s%s\n' "$C_INFO" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
die()  { printf '%s  ✗ %s%s\n' "$C_ERR" "$*" "$C_RESET" >&2; exit 1; }

on_error() {
  local code=$? line=${1:-?}
  printf '\n%s部署中断（第 %s 行，退出码 %s）%s\n' "$C_ERR" "$line" "$code" "$C_RESET" >&2
  [[ -n "$LOG_FILE" && -f "$LOG_FILE" ]] && printf '完整日志: %s\n' "$LOG_FILE" >&2
  exit "$code"
}
trap 'on_error $LINENO' ERR

print_usage() {
  cat <<'USAGE'
宏盟机械独立站一键部署

用法: scripts/deploy-one-click.sh [选项]

  --domain www.example.com          官网域名
  --admin-domain admin.example.com  后台域名
  --service-domain s.example.com    客服域名
  --email ops@example.com           证书通知邮箱
  --dir /opt/hongmeng-machinery     安装目录
  --ref v1.0.1                      指定版本（默认 main）
  --yes                             全程不询问
  --monitoring                      启用监控面板
  --no-backup                       升级前不备份
  --rollback                        回滚上一版本
  --check                           只体检
  --skip-docker-install             不自动装 Docker
USAGE
}

parse_args() {
  while (($#)); do
    case "$1" in
      --domain) SITE_DOMAIN="${2:-}"; shift 2 ;;
      --admin-domain) ADMIN_DOMAIN="${2:-}"; shift 2 ;;
      --service-domain) SERVICE_DOMAIN="${2:-}"; shift 2 ;;
      --email) ACME_EMAIL="${2:-}"; shift 2 ;;
      --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
      --ref) TARGET_REF="${2:-}"; shift 2 ;;
      --token) TOKEN="${2:-}"; shift 2 ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --monitoring) ENABLE_MONITORING=1; shift ;;
      --no-backup) DO_BACKUP=0; shift ;;
      --rollback) DO_ROLLBACK=1; shift ;;
      --check) CHECK_ONLY=1; shift ;;
      --skip-docker-install) SKIP_DOCKER_INSTALL=1; shift ;;
      --help|-h) print_usage; exit 0 ;;
      *) die "未知参数: $1（--help 查看用法）" ;;
    esac
  done
}

in_repo_root() {
  local self="${BASH_SOURCE[0]:-}"
  [[ -n "$self" && -f "$self" ]] || return 1
  local dir
  dir="$(cd "$(dirname "$self")/.." && pwd)" || return 1
  [[ -f "$dir/deployments/ubuntu/docker-compose.ubuntu.yml" ]] || return 1
  INSTALL_DIR="$dir"
}

# 管道执行时：把脚本落到临时文件、克隆仓库，再从仓库内重新执行。
ensure_repo() {
  in_repo_root && return 0

  local self="${BASH_SOURCE[0]:-}" tmp
  tmp="$(mktemp /tmp/hongmeng-deploy-XXXXXX)"

  if [[ -n "$self" && -f "$self" ]]; then
    cp "$self" "$tmp"
  else
    log "下载部署脚本"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null 2>&1 || true
    command -v curl >/dev/null 2>&1 || apt-get install -y -qq curl ca-certificates >/dev/null 2>&1 || true
    if [[ -n "$TOKEN" ]]; then
      curl -fsSL -m 30 -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.raw" \
        "https://api.github.com/repos/${REPO_SLUG}/contents/scripts/deploy-one-click.sh?ref=main" -o "$tmp" \
        || die "下载脚本失败，请检查令牌与网络"
    else
      # raw.githubusercontent 在部分网络（含大陆）不可达，逐条换源。
      local src ok_dl=0
      for src in \
        "$RAW_SCRIPT" \
        "https://ghproxy.net/${RAW_SCRIPT}" \
        "https://ghfast.top/${RAW_SCRIPT}" \
        "https://gh-proxy.com/${RAW_SCRIPT}" \
        "https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main/scripts/deploy-one-click.sh"; do
        if curl -fsSL -m 30 "$src" -o "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then ok_dl=1; break; fi
      done
      ((ok_dl == 1)) || die "下载脚本失败：官方与镜像都不通，请检查网络"
    fi
  fi
  chmod +x "$tmp"

  if [[ "${EUID}" -ne 0 ]]; then
    log "需要 root 权限，正在提权…"
    exec sudo -E bash "$tmp" "$@"
  fi

  step "准备代码目录"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || true
  command -v git >/dev/null 2>&1 || apt-get install -y -qq git ca-certificates openssl >/dev/null 2>&1 || true
  command -v git >/dev/null 2>&1 || die "无法安装 git"

  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    ok "复用已有安装目录: $INSTALL_DIR"
  else
    clone_repo "$INSTALL_DIR"
  fi
  exec bash "$INSTALL_DIR/scripts/deploy-one-click.sh" "$@"
}

require_root() {
  [[ "${EUID}" -eq 0 ]] && return 0
  exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
}

probe_latency() {
  local url="$1" total=0 n=0 t
  for _ in 1 2; do
    t=$(curl -o /dev/null -sS -m 6 -w '%{time_total}' "$url" 2>/dev/null) || t=""
    if [[ -n "$t" ]]; then total=$(awk -v a="$total" -v b="$t" 'BEGIN{print a+b}'); n=$((n + 1)); fi
  done
  ((n == 0)) && { echo 99; return 0; }
  awk -v a="$total" -v b="$n" 'BEGIN{printf "%.3f", a/b}'
}

# 用法: pick_fastest <名称> "url|线路名" ...
pick_fastest() {
  local label="$1"; shift
  local best="" best_t=99 item url name t
  for item in "$@"; do
    url="${item%%|*}"; name="${item##*|}"
    t=$(probe_latency "$url")
    log "  测速 ${label} · ${name}: ${t}s" >&2
    if awk -v a="$t" -v b="$best_t" 'BEGIN{exit !(a<b)}'; then best_t="$t"; best="$item"; fi
  done
  [[ -n "$best" ]] || best="$1"
  log "  选用 ${label} · ${best##*|} (${best_t}s)" >&2
  printf '%s' "$best"
}

# ---------------------------------------------------------------- 体检
detect_os() {
  [[ -r /etc/os-release ]] || die "无法识别系统（缺 /etc/os-release）"
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-}"
  DISTRO_CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
  case "$DISTRO_ID" in
    ubuntu|debian) ;;
    *) warn "仅在 Ubuntu / Debian 验证过，当前为 ${DISTRO_ID}，继续但可能失败" ;;
  esac
  [[ -n "$DISTRO_CODENAME" ]] || die "无法识别系统代号（VERSION_CODENAME）"

  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|aarch64) ;;
    *) die "不支持的架构: $ARCH" ;;
  esac

  PUBLIC_IP="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || curl -fsS -m 5 https://ifconfig.me 2>/dev/null || true)"
  [[ -n "$PUBLIC_IP" ]] || warn "取不到公网 IP，DNS 校验将跳过"
}

ensure_tools() {
  local missing=() pkg
  for pkg in ss dig openssl curl; do
    command -v "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  ((${#missing[@]} == 0)) && return 0
  log "补齐缺失的基础命令: ${missing[*]}"
  apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} update -qq >/dev/null 2>&1 || true
  apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} install -y -qq iproute2 dnsutils openssl curl ca-certificates >/dev/null 2>&1 \
    || warn "基础命令补齐失败，继续"
}

check_resources() {
  local cpus mem_mb avail_gb
  cpus=$(nproc 2>/dev/null || echo 1)
  mem_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
  avail_gb=$(df -Pk /var/lib 2>/dev/null | awk 'NR==2{printf "%d", $4/1048576}' || echo 0)

  ((cpus >= MIN_CPU)) || warn "CPU 只有 ${cpus} 核（建议 ≥${MIN_CPU}），构建会较慢"
  if ((mem_mb < MIN_MEM_MB)); then
    warn "内存 ${mem_mb}MB 偏低（建议 ≥${MIN_MEM_MB}MB），补 2G swap"
    ensure_swap
  fi
  ((avail_gb >= MIN_DISK_GB)) || die "磁盘可用 ${avail_gb}GB，至少需要 ${MIN_DISK_GB}GB"
  ok "资源: ${cpus} 核 / ${mem_mb}MB 内存 / 可用 ${avail_gb}GB"
}

ensure_swap() {
  swapon --show 2>/dev/null | grep -q . && { ok "已有 swap"; return 0; }
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "已启用 2G swap"
}

# 80/443 若由本 stack 自己的容器占着，升级时会被重建，不算冲突。
ports_held_by_own_stack() {
  command -v docker >/dev/null 2>&1 || return 1
  local name project found=0
  while read -r name; do
    [[ -z "$name" ]] && continue
    project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null || true)
    [[ "$project" == "$STACK_NAME" ]] && found=1
  done < <(docker ps --filter "publish=80" --format '{{.Names}}' 2>/dev/null; docker ps --filter "publish=443" --format '{{.Names}}' 2>/dev/null)
  ((found == 1))
}

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

check_ports() {
  local port busy="" owner="" holders=""
  for port in 80 443; do
    port_busy "$port" && busy+=" $port"
  done
  if [[ -z "$busy" ]]; then ok "端口 80/443 空闲"; return 0; fi
  if ports_held_by_own_stack; then ok "端口 80/443 由本 stack 现有容器占用（升级会被重建）"; return 0; fi

  warn "端口${busy} 已被其它程序占用"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :80 or sport = :443" 2>/dev/null | sed 's/^/      /' || true
    owner=$(ss -ltnpH "sport = :80 or sport = :443" 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | sed 's/.*("//' | sort -u | tr '\n' ' ' || true)
  fi
  holders=$(docker ps --filter "publish=80" --filter "publish=443" --format '{{.Names}}' 2>/dev/null || true)
  [[ -n "$holders" ]] && printf '      占用容器: %s\n' "$(echo $holders)"
  if [[ "$owner" == nginx* || "$owner" == apache2* || "$owner" == httpd* ]]; then
    if confirm "停止系统自带的 ${owner%/} 让 Caddy 独占 80/443？"; then
      systemctl disable --now nginx >/dev/null 2>&1 || true
      systemctl disable --now apache2 >/dev/null 2>&1 || true
      sleep 2
    fi
  fi
  for port in 80 443; do
    port_busy "$port" && die "端口 $port 仍被占用：先停掉占用方（容器可 docker stop <名称>）再重跑"
  done
  ok "端口 80/443 就绪"
}

check_clock() {
  if timedatectl 2>/dev/null | grep -q 'synchronized: yes'; then ok "系统时钟已同步"; return 0; fi
  warn "系统时钟未同步，证书签发可能失败，尝试启用 NTP"
  timedatectl set-ntp true >/dev/null 2>&1 || true
  sleep 3
  timedatectl 2>/dev/null | grep -q 'synchronized: yes' && ok "已同步" || warn "仍不同步，请检查 chrony / systemd-timesyncd"
}

preflight() {
  step "环境检查"
  detect_os
  ensure_tools
  check_clock
  check_resources
  check_ports
  ok "基础体检完成"
}

# ---------------------------------------------------------------- 线路优选
configure_apt_mirror() {
  local chosen base suite
  local candidates=(
    "https://mirrors.aliyun.com|阿里云"
    "https://mirrors.tuna.tsinghua.edu.cn|清华"
    "https://mirrors.ustc.edu.cn|中科大"
    "https://mirrors.cloud.tencent.com|腾讯云"
  )
  [[ "$DISTRO_ID" == "ubuntu" ]] || candidates+=("https://deb.debian.org|官方")
  chosen=$(pick_fastest "apt 源" "${candidates[@]}")
  MIRROR_APT="${chosen%%|*}"
  base="$MIRROR_APT/${DISTRO_ID}"

  # 先把发行版自带的 deb822 源移走，避免和新源重复。
  local f
  for f in /etc/apt/sources.list.d/*.sources; do
    [[ -f "$f" ]] || continue
    [[ "$f" == *.hongmeng.bak ]] && continue
    mv "$f" "${f}.hongmeng.bak"
  done
  [[ -f /etc/apt/sources.list.hongmeng.bak ]] || cp -a /etc/apt/sources.list /etc/apt/sources.list.hongmeng.bak 2>/dev/null || true

  {
    echo "# 由 deploy-one-click.sh 按测速结果生成，原文件见 *.hongmeng.bak"
    for suite in "$DISTRO_CODENAME" "${DISTRO_CODENAME}-updates" "${DISTRO_CODENAME}-backports" "${DISTRO_CODENAME}-security"; do
      echo "deb ${base} ${suite} main restricted universe multiverse"
    done
  } >/etc/apt/sources.list

  APT_OPTS=(-o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15)
  apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} update -qq
  ok "apt 源已指向 ${MIRROR_APT}"
}

configure_docker_mirror() {
  local chosen mirror
  chosen=$(pick_fastest "Docker 镜像" \
    "https://docker.m.daocloud.io|DaoCloud" \
    "https://mirror.ccs.tencentyun.com|腾讯云" \
    "https://docker.1panel.live|1Panel" \
    "https://dockerproxy.net|DockerProxy")
  mirror="${chosen%%|*}"

  mkdir -p /etc/docker
  command -v python3 >/dev/null 2>&1 || apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} install -y -qq python3 >/dev/null
  python3 - "$mirror" <<'PY'
import json, pathlib, sys
p = pathlib.Path('/etc/docker/daemon.json')
try:
    cfg = json.loads(p.read_text()) if p.exists() else {}
except Exception:
    cfg = {}
cfg.setdefault('log-driver', 'json-file')
cfg['log-opts'] = {'max-size': '20m', 'max-file': '3'}
mirrors = [m for m in (cfg.get('registry-mirrors') or []) if m != sys.argv[1]]
cfg['registry-mirrors'] = [sys.argv[1]] + mirrors[:2]
p.write_text(json.dumps(cfg, indent=2) + '\n')
PY
  ok "Docker 镜像加速: $mirror"
}

clone_repo() {
  local dest="$1" chosen url auth_url
  auth_url="https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git"

  if [[ -n "$TOKEN" ]]; then
    # 私有仓库走代理会丢令牌，直接连 GitHub。
    log "克隆私有仓库到 $dest"
    git clone --quiet "$auth_url" "$dest" || die "克隆失败，检查令牌是否有该仓库读权限"
    ok "代码已就绪"
    return 0
  fi

  chosen=$(pick_fastest "代码下载" \
    "https://ghproxy.net/https://github.com/${REPO_SLUG}.git|ghproxy" \
    "https://gh-proxy.com/https://github.com/${REPO_SLUG}.git|gh-proxy" \
    "https://ghfast.top/https://github.com/${REPO_SLUG}.git|ghfast" \
    "${REPO_URL}|直连")
  url="${chosen%%|*}"
  # 直连时留空，避免拼出 https:https://...
  MIRROR_GH=""
  [[ "$url" != "$REPO_URL" ]] && MIRROR_GH="${url%%https://github.com*}"

  log "克隆仓库到 $dest"
  if ! git clone --quiet "$url" "$dest"; then
    warn "首选线路失败，改用直连"
    git clone --quiet "$REPO_URL" "$dest" || die "克隆失败：仓库若为私有，请加 --token <PAT> 或用 HONGMENG_TOKEN 传入"
  fi
  git -C "$dest" remote set-url origin "$REPO_URL"
  ok "代码已就绪"
}

# ---------------------------------------------------------------- Docker
docker_ready() { command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }

install_docker() {
  if docker_ready; then return 0; fi
  if [[ "$SKIP_DOCKER_INSTALL" == 1 ]]; then die "--skip-docker-install 但本机没有可用的 Docker"; fi

  step "安装 Docker Engine 与 compose 插件"
  apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} install -y -qq ca-certificates curl gnupg >/dev/null
  if apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} install -y -qq docker.io docker-compose-v2 >/dev/null 2>&1 && docker_ready; then
    ok "已通过发行版仓库安装"
  else
    warn "发行版仓库不可用，改用 Docker 官方脚本"
    local source="https://get.docker.com" tmp
    tmp="$(mktemp)"
    [[ -n "$MIRROR_GH" ]] && source="${MIRROR_GH}${source}"
    curl -fsSL -m 30 "$source" -o "$tmp" 2>/dev/null || curl -fsSL -m 30 https://get.docker.com -o "$tmp"
    sh "$tmp" >/dev/null 2>&1 || die "Docker 安装失败"
    rm -f "$tmp"
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker_ready || die "Docker 安装后仍不可用"
}

assert_docker_versions() {
  local engine_major compose_ver major minor
  engine_major=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)
  [[ -n "$engine_major" ]] || die "Docker 守护进程未运行"
  ((engine_major >= MIN_ENGINE_MAJOR)) || die "Docker ${engine_major}.x 过低，需 ≥${MIN_ENGINE_MAJOR}.x"

  compose_ver=$(docker compose version --short 2>/dev/null || true)
  [[ -n "$compose_ver" ]] || die "compose 插件缺失"
  major="${compose_ver%%.*}"; minor="${compose_ver#*.}"; minor="${minor%%.*}"
  if ((major == 2)) && awk -v a="$minor" -v b="${MIN_COMPOSE_MINOR#*.}" 'BEGIN{exit !(a<b)}'; then
    warn "compose 插件 ${compose_ver} 偏低，尝试升级"
    apt-get ${APT_OPTS[@]+"${APT_OPTS[@]}"} install -y -qq --only-upgrade docker-compose-plugin docker-compose-v2 >/dev/null 2>&1 || true
    compose_ver=$(docker compose version --short 2>/dev/null || echo "$compose_ver")
  fi
  ((engine_major > MAX_TESTED_ENGINE_MAJOR)) && warn "引擎 ${engine_major}.x 高于验证过的 ${MAX_TESTED_ENGINE_MAJOR}.x，异常时可用 --rollback 回退"
  ok "Docker $(docker version --format '{{.Server.Version}}') / compose ${compose_ver}"
}

compose() { docker compose -f "$DEPLOY_DIR/docker-compose.ubuntu.yml" --env-file "$ENV_FILE" -p "$STACK_NAME" ${COMPOSE_PROFILE[@]+"${COMPOSE_PROFILE[@]}"} "$@"; }

# ---------------------------------------------------------------- 代码同步
resolve_target_ref() {
  # 默认跟 main（发布都打在 main 上）；旧 tag 版本号更大，按版本排会挑错，故不自动选 tag。
  [[ -n "$TARGET_REF" ]] && { printf '%s' "$TARGET_REF"; return 0; }
  printf 'main'
}

update_code() {
  step "同步代码"
  cd "$INSTALL_DIR"
  git config --local advice.detachedHead false >/dev/null 2>&1 || true
  PREVIOUS_REF="$(git rev-parse --short HEAD 2>/dev/null || echo '')"
  [[ -n "$PREVIOUS_REF" ]] && printf '%s\n' "$PREVIOUS_REF" >"$STATE_DIR/previous-ref"

  git fetch --quiet --tags --force origin 2>/dev/null || warn "拉取远端失败，沿用本地"

  local target
  target="$(resolve_target_ref)"
  log "目标版本: $target"
  if [[ "$target" != "main" ]] && git rev-parse --verify --quiet "refs/tags/${target}^{commit}" >/dev/null; then
    git checkout --quiet --force "$target"
    ok "已切换到 ${target}"
  else
    git checkout --quiet --force main 2>/dev/null || true
    git pull --quiet --ff-only origin main
    ok "已更新到 main"
  fi
  ok "当前提交: $(git rev-parse --short HEAD)"
}

do_rollback() {
  local prev
  prev="$(cat "$STATE_DIR/previous-ref" 2>/dev/null || true)"
  [[ -n "$prev" ]] || die "没有可回滚的版本记录"
  if ! git -C "$INSTALL_DIR" rev-parse --verify --quiet "${prev}^{commit}" >/dev/null; then
    # 浅克隆时目标提交可能还没拉下来，先加深再试。
    git -C "$INSTALL_DIR" fetch --quiet --deepen=100 origin 2>/dev/null || true
    git -C "$INSTALL_DIR" rev-parse --verify --quiet "${prev}^{commit}" >/dev/null \
      || die "回滚目标 ${prev} 已不在仓库中"
  fi
  step "回滚到 $prev"
  git -C "$INSTALL_DIR" checkout --quiet --force "$prev"
  HAD_INSTALL=1
  rebuild_and_up
  if retry_health; then print_summary; exit 0; fi
  die "回滚后健康检查仍未通过"
}

# ---------------------------------------------------------------- 交互
ask() {
  local prompt="$1" default="${2:-}" answer=""
  if ((ASSUME_YES == 1)) && [[ -n "$default" ]]; then printf '%s' "$default"; return 0; fi
  [[ -r /dev/tty ]] && read -r -p "  ${prompt}${default:+ [$default]}: " answer </dev/tty || true
  printf '%s' "${answer:-$default}"
}

confirm() {
  local prompt="$1" answer=""
  ((ASSUME_YES == 1)) && return 0
  [[ -r /dev/tty ]] || return 0
  read -r -p "  ${prompt} [Y/n]: " answer </dev/tty || true
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

valid_domain() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; }

collect_domains() {
  step "站点域名"
  if ((ASSUME_YES == 1)) && [[ -z "$SITE_DOMAIN$ADMIN_DOMAIN$SERVICE_DOMAIN$ACME_EMAIL" ]]; then
    die "--yes 需同时提供 --domain/--admin-domain/--service-domain/--email"
  fi

  local hint=""
  if [[ -z "$SITE_DOMAIN" || -z "$ADMIN_DOMAIN" || -z "$SERVICE_DOMAIN" ]]; then
    hint=$(ask "主域名（如 example.com，用于生成默认子域）" "")
  fi
  [[ -z "$SITE_DOMAIN" ]] && SITE_DOMAIN=$(ask "官网域名" "${hint:+www.$hint}")
  [[ -z "$ADMIN_DOMAIN" ]] && ADMIN_DOMAIN=$(ask "后台域名" "${hint:+admin.$hint}")
  [[ -z "$SERVICE_DOMAIN" ]] && SERVICE_DOMAIN=$(ask "客服域名" "${hint:+service.$hint}")
  [[ -z "$ACME_EMAIL" ]] && ACME_EMAIL=$(ask "证书通知邮箱" "")

  local d
  for d in "$SITE_DOMAIN" "$ADMIN_DOMAIN" "$SERVICE_DOMAIN"; do
    valid_domain "$d" || die "域名格式不正确: ${d:-(空)}"
  done
  [[ "$ACME_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$ ]] || die "邮箱格式不正确: ${ACME_EMAIL:-(空)}"
  [[ "$SITE_DOMAIN" != "$ADMIN_DOMAIN" && "$SITE_DOMAIN" != "$SERVICE_DOMAIN" && "$ADMIN_DOMAIN" != "$SERVICE_DOMAIN" ]] \
    || die "三个域名不能相同"

  verify_dns "$SITE_DOMAIN" "$ADMIN_DOMAIN" "$SERVICE_DOMAIN"
  ok "官网 https://$SITE_DOMAIN ｜ 后台 https://$ADMIN_DOMAIN ｜ 客服 https://$SERVICE_DOMAIN"
  confirm "确认使用以上域名部署？" || die "已取消"
}

verify_dns() {
  local d resolved bad=0
  [[ -n "$PUBLIC_IP" ]] || return 0
  for d in "$@"; do
    resolved=$(dig +short A "$d" 2>/dev/null | tail -1)
    if [[ -z "$resolved" ]]; then
      warn "$d 尚无 A 记录，证书签发会失败"; bad=1
    elif [[ "$resolved" != "$PUBLIC_IP" ]]; then
      warn "${d} 解析到 ${resolved}，与本机公网 IP ${PUBLIC_IP} 不一致"; bad=1
    else
      ok "$d → $PUBLIC_IP"
    fi
  done
  if ((bad == 1)); then confirm "DNS 仍继续？（用了 CDN/代理可忽略）" || die "请先修好 DNS"; fi
  return 0
}

# ---------------------------------------------------------------- 配置
rand_hex() { openssl rand -hex "${1:-24}"; }
rand_pw() { local s; s="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-"${1:-24}")"; printf '%s' "$s"; }

env_get() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

write_env_file() {
  step "生成运行时配置"
  local pg_user="site" pg_db="customer_service"
  local pg_pass data_key admin_pass agent_pass session_secret hook_secret metrics_token grafana_pass media_secret

  if [[ -f "$ENV_FILE" ]]; then
    ok "沿用已有 ${ENV_FILE}（只刷新域名相关项）"
    pg_user="$(env_get POSTGRES_USER)"; pg_db="$(env_get POSTGRES_DB)"
    pg_user="${pg_user:-site}"; pg_db="${pg_db:-customer_service}"
    pg_pass="$(env_get POSTGRES_PASSWORD)"; data_key="$(env_get DATA_ENCRYPTION_KEY)"
    admin_pass="$(env_get ADMIN_BOOTSTRAP_PASSWORD)"; agent_pass="$(env_get AGENT_BOOTSTRAP_PASSWORD)"
    session_secret="$(env_get ADMIN_2FA_SESSION_SECRET)"; hook_secret="$(env_get REBUILD_WEBHOOK_SECRET)"
    metrics_token="$(env_get METRICS_BEARER_TOKEN)"; media_secret="$(env_get S3_SECRET_ACCESS_KEY)"
    grafana_pass="$(env_get GRAFANA_ADMIN_PASSWORD)"
  fi

  pg_pass="${pg_pass:-$(rand_pw 32)}"
  data_key="${data_key:-$(rand_pw 40)}"
  admin_pass="${admin_pass:-$(rand_pw 18)}"
  agent_pass="${agent_pass:-$(rand_pw 18)}"
  session_secret="${session_secret:-$(rand_hex 24)}"
  hook_secret="${hook_secret:-$(rand_hex 20)}"
  metrics_token="${metrics_token:-$(rand_hex 24)}"
  media_secret="${media_secret:-$(rand_pw 24)}"
  grafana_pass="${grafana_pass:-$(rand_pw 20)}"
  [[ -n "$(env_get ADMIN_BOOTSTRAP_PASSWORD)" ]] || ok "已生成强随机密钥"

  umask 077
  cat >"$ENV_FILE" <<EOF
# 由 scripts/deploy-one-click.sh 生成于 $(date -Iseconds)；升级时保留，可直接改。
SITE_DOMAIN=$SITE_DOMAIN
ADMIN_DOMAIN=$ADMIN_DOMAIN
SERVICE_DOMAIN=$SERVICE_DOMAIN
ACME_EMAIL=$ACME_EMAIL

POSTGRES_DB=$pg_db
POSTGRES_USER=$pg_user
POSTGRES_PASSWORD=$pg_pass
DATABASE_URL=postgres://$pg_user:$pg_pass@postgres:5432/$pg_db?sslmode=disable
REDIS_ADDR=redis:6379

DATA_ENCRYPTION_KEY=$data_key
ADMIN_BOOTSTRAP_PASSWORD=$admin_pass
AGENT_BOOTSTRAP_PASSWORD=$agent_pass
SERVICEBRIDGE_ADMIN_ACCOUNT=superadmin
ADMIN_2FA_SESSION_SECRET=$session_secret
ADMIN_2FA_ISSUER=宏盟机械管理台
ADMIN_2FA_SESSION_TTL_MS=43200000
REBUILD_WEBHOOK_SECRET=$hook_secret
REBUILD_WEBHOOK_PORT=8787
METRICS_BEARER_TOKEN=$metrics_token

CORS_ALLOWED_ORIGINS=https://$SITE_DOMAIN,https://$ADMIN_DOMAIN,https://$SERVICE_DOMAIN
FRAME_ANCESTORS=https://$SITE_DOMAIN
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128,172.16.0.0/12
SECURITY_HEADERS=true
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPS=20
RATE_LIMIT_BURST=60

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_TYPE=chat_completions

UPLOAD_DRIVER=local
UPLOAD_PUBLIC_BASE_URL=https://$SERVICE_DOMAIN
UPLOAD_MAX_BYTES=10485760

# 素材走内置对象存储（SeaweedFS 的 S3 网关，经 Caddy 在后台域名暴露）。
# 换外部 S3/R2：改 S3_ENDPOINT / S3_BUCKET / 凭据与 S3_FORCE_PATH_STYLE 后重跑脚本。
ADMIN_MEDIA_DRIVER=s3
ADMIN_S3_KEY_PREFIX=site-admin
ADMIN_S3_SERVER_SIDE_ENCRYPTION=
S3_ENDPOINT=https://$ADMIN_DOMAIN
S3_REGION=us-east-1
S3_BUCKET=$MEDIA_BUCKET
S3_ACCESS_KEY_ID=$MEDIA_ACCESS_KEY
S3_SECRET_ACCESS_KEY=$media_secret
S3_SESSION_TOKEN=
S3_FORCE_PATH_STYLE=true
S3_KEY_PREFIX=uploads
S3_PUBLIC_BASE_URL=https://$ADMIN_DOMAIN/$MEDIA_BUCKET

PROMETHEUS_RETENTION=15d
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=$grafana_pass
GRAFANA_ROOT_URL=http://127.0.0.1:3000
PROMETHEUS_HOST_PORT=127.0.0.1:9090
GRAFANA_HOST_PORT=127.0.0.1:3000
EOF
  chmod 600 "$ENV_FILE"; umask 022

  cat >"$CRED_FILE" <<EOF
# 后台登录凭据（$(date -Iseconds)）
后台地址: https://$ADMIN_DOMAIN/site-admin/
管理员账号: superadmin
管理员密码: $admin_pass
客服坐席密码: $agent_pass
Grafana: http://127.0.0.1:3000 （admin / ${grafana_pass}）
环境文件: $ENV_FILE
EOF
  chmod 600 "$CRED_FILE"
  ok "配置已写入 ${ENV_FILE}（600），凭据见 ${CRED_FILE}"
  assert_no_placeholders
}

assert_no_placeholders() {
  local name value
  for name in SITE_DOMAIN ADMIN_DOMAIN SERVICE_DOMAIN ACME_EMAIL POSTGRES_PASSWORD DATA_ENCRYPTION_KEY \
              ADMIN_BOOTSTRAP_PASSWORD ADMIN_2FA_SESSION_SECRET REBUILD_WEBHOOK_SECRET METRICS_BEARER_TOKEN S3_SECRET_ACCESS_KEY; do
    value="$(env_get "$name")"
    [[ -n "$value" ]] || die "$name 为空"
    [[ "$value" == *change-me* ]] && die "$name 还是占位值"
  done
  value="$(env_get DATA_ENCRYPTION_KEY)"
  (( ${#value} >= 32 )) || die "DATA_ENCRYPTION_KEY 至少 32 字符"
}

# ---------------------------------------------------------------- 部署
detect_existing() {
  if docker volume ls -q 2>/dev/null | grep -qx "${STACK_NAME}_postgres-data"; then
    HAD_INSTALL=1
    ok "检测到既有部署：原地升级，数据卷保留"
  elif [[ -n "$(docker ps -aq --filter label=com.docker.compose.project=$STACK_NAME 2>/dev/null)" ]]; then
    HAD_INSTALL=1
    ok "检测到既有容器：原地升级"
  else
    ok "全新部署"
  fi
}

backup_before_upgrade() {
  ((HAD_INSTALL == 1 && DO_BACKUP == 1)) || return 0
  [[ -x "$INSTALL_DIR/scripts/backup-production.sh" ]] || { warn "无备份脚本，跳过预备份"; return 0; }
  [[ -n "$(docker volume ls -q 2>/dev/null | grep -x "${STACK_NAME}_postgres-data" || true)" ]] || { warn "尚无数据库卷，跳过预备份"; return 0; }
  step "升级前备份数据库"
  local dir="$STATE_DIR/backups"; mkdir -p "$dir"; chmod 700 "$dir"
  if ASTREVA_BACKUP_DIR="$dir" ASTREVA_UBUNTU_ENV="$ENV_FILE" HONGMENG_UBUNTU_ENV="$ENV_FILE" \
     bash "$INSTALL_DIR/scripts/backup-production.sh" >/dev/null 2>&1; then
    ok "备份完成: $(ls -1t "$dir" | head -1)"
  else
    warn "预备份失败（继续，升级不触碰数据卷）"
  fi
}

rebuild_and_up() {
  step "构建并启动容器"
  compose pull --quiet 2>/dev/null || true
  compose build --pull 2>&1 | tail -3
  compose up -d --remove-orphans --wait --wait-timeout 600 2>&1 | tail -5 || {
    warn "健康等待未全绿，改为后台启动并继续检查"
    compose up -d --remove-orphans 2>&1 | tail -5
  }
  ok "容器已启动（未执行 down，数据卷保持不变）"
}

containers_unhealthy() {
  local bad=0 line name state status
  while IFS='|' read -r name state status; do
    [[ -z "$name" ]] && continue
    if [[ "$state" != "running" ]]; then warn "容器 $name 状态 $state"; bad=1; continue; fi
    [[ "$status" == *unhealthy* ]] && { warn "容器 $name 不健康"; bad=1; }
  done < <(docker ps -a --filter "label=com.docker.compose.project=$STACK_NAME" \
             --format '{{.Names}}|{{.State}}|{{.Status}}')
  ((bad == 0))
}

http_status() {
  local method="$1" url="$2" host="$3"
  if [[ "$method" == "GET" ]]; then
    curl -sS ${CURL_OPTS[@]+"${CURL_OPTS[@]}"} -o /dev/null -m 15 --resolve "$host:443:127.0.0.1" -w '%{http_code}' "$url" 2>/dev/null || echo 000
  else
    curl -sS ${CURL_OPTS[@]+"${CURL_OPTS[@]}"} -o /dev/null -m 15 --resolve "$host:443:127.0.0.1" -X POST \
      -H 'content-type: application/json' \
      -d '{"name":"部署自检","email":"deploy@example.com","message":"deploy-one-click self test"}' \
      -w '%{http_code}' "$url" 2>/dev/null || echo 000
  fi
}

check_http() {
  local label="$1" accept="$2" method="$3" host="$4" path="$5" code
  code="$(http_status "$method" "https://$host$path" "$host")"
  if [[ ",$accept," == *",$code,"* ]]; then ok "$label → $code"; return 0; fi
  warn "${label} → ${code}（期望 ${accept}）"; return 1
}

wait_for_tls() {
  local host="$1" i=0
  while ((i < 40)); do
    curl -sS ${CURL_OPTS[@]+"${CURL_OPTS[@]}"} -o /dev/null -m 5 --resolve "$host:443:127.0.0.1" "https://$host/" 2>/dev/null && return 0
    sleep 5; i=$((i + 1))
  done
  return 1
}

days_left() {
  # $1 为 openssl -enddate 的输出值；GNU / BSD date 都支持。
  local end="$1" epoch
  epoch=$(date -d "$end" +%s 2>/dev/null) || epoch=$(date -j -f '%b %d %T %Y %Z' "$end" +%s 2>/dev/null) || { echo "?"; return 0; }
  echo $(( (epoch - $(date +%s)) / 86400 ))
}

check_certificates() {
  local host out issuer enddate days bad=0
  for host in "$SITE_DOMAIN" "$ADMIN_DOMAIN" "$SERVICE_DOMAIN"; do
    if ! out=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$host" 2>/dev/null); then
      warn "取不到 $host 的证书"; bad=1; continue
    fi
    issuer=$(printf '%s' "$out" | openssl x509 -noout -issuer 2>/dev/null || true)
    if [[ "$issuer" == *"Let's Encrypt"* ]]; then
      ok "$host 证书由 Let's Encrypt 签发"
    else
      warn "$host 签发者非 Let's Encrypt: ${issuer:-未知}"
    fi
    enddate=$(printf '%s' "$out" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    days=$(days_left "$enddate")
    if printf '%s' "$out" | openssl x509 -noout -checkend 604800 >/dev/null 2>&1; then
      if printf '%s' "$out" | openssl x509 -noout -checkend 2592000 >/dev/null 2>&1; then
        ok "$host 证书剩余 ${days} 天（Caddy 自动续期）"
      else
        warn "$host 证书剩余 ${days} 天，已在续期窗口内"
      fi
    else
      warn "$host 证书剩余 ${days} 天，7 天内过期，续期异常"; bad=1
    fi
  done
  ((bad == 0))
}

run_health_checks() {
  step "健康检查"
  local fails=0
  wait_for_tls "$SITE_DOMAIN" || warn "官网 HTTPS 暂不可用，继续逐项检查"
  sleep 3

  check_http "官网首页" "200" GET "$SITE_DOMAIN" "/" || fails=$((fails + 1))
  check_http "官网中文页" "200" GET "$SITE_DOMAIN" "/zh/" || fails=$((fails + 1))
  check_http "官网商品列表" "200" GET "$SITE_DOMAIN" "/shop/" || fails=$((fails + 1))
  check_http "官网站点地图" "200" GET "$SITE_DOMAIN" "/sitemap-products.xml" || fails=$((fails + 1))
  check_http "咨询单接口" "200,201" POST "$SITE_DOMAIN" "/site-admin-api/leads" || fails=$((fails + 1))
  check_http "后台健康" "200" GET "$ADMIN_DOMAIN" "/healthz" || fails=$((fails + 1))
  check_http "后台登录页" "200" GET "$ADMIN_DOMAIN" "/site-admin/login" || fails=$((fails + 1))
  check_http "后台 2FA 入口" "200,302" GET "$ADMIN_DOMAIN" "/admin-2fa" || fails=$((fails + 1))
  check_http "后台控制台" "200" GET "$ADMIN_DOMAIN" "/site-admin/" || fails=$((fails + 1))
  check_http "接口文档" "200" GET "$ADMIN_DOMAIN" "/openapi.json" || fails=$((fails + 1))
  check_http "素材存储" "200,403" GET "$ADMIN_DOMAIN" "/$MEDIA_BUCKET" || fails=$((fails + 1))
  check_http "客服健康" "200" GET "$SERVICE_DOMAIN" "/healthz" || fails=$((fails + 1))
  check_http "客服就绪" "200" GET "$SERVICE_DOMAIN" "/readyz" || fails=$((fails + 1))
  check_http "客服页面" "200" GET "$SERVICE_DOMAIN" "/?embed=1" || fails=$((fails + 1))
  check_http "客服接口" "200,401" GET "$SERVICE_DOMAIN" "/api/agent/preferences" || fails=$((fails + 1))

  containers_unhealthy || fails=$((fails + 1))
  check_certificates || fails=$((fails + 1))

  if ((fails == 0)); then ok "健康检查全部通过"; return 0; fi
  warn "共 ${fails} 项未通过"
  return 1
}

retry_health() {
  local attempt
  for attempt in 1 2 3; do
    run_health_checks && return 0
    ((attempt == 3)) && break
    warn "第 ${attempt} 轮未全绿，60 秒后重试"
    sleep 60
  done
  return 1
}

setup_backup_cron() {
  local script="$INSTALL_DIR/scripts/backup-production.sh" line
  [[ -x "$script" ]] || return 0
  command -v crontab >/dev/null 2>&1 || { warn "无 crontab，跳过每日备份计划"; return 0; }
  mkdir -p "$STATE_DIR/backups"
  line="0 2 * * * ASTREVA_BACKUP_DIR=$STATE_DIR/backups $script >/dev/null 2>&1"
  (crontab -l 2>/dev/null | grep -v 'backup-production.sh' || true; echo "$line") | crontab -
  ok "已配置每日 02:00 数据库备份"
}

open_firewall() {
  command -v ufw >/dev/null 2>&1 || return 0
  ufw status 2>/dev/null | grep -q 'Status: active' || return 0
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ok "已放通 ufw 80/443"
}

print_summary() {
  cat <<EOF

${C_OK}${C_BOLD}部署完成${C_RESET}

  官网    https://$SITE_DOMAIN
  后台    https://$ADMIN_DOMAIN/site-admin/
  客服    https://$SERVICE_DOMAIN/?embed=1
  接口    https://$SERVICE_DOMAIN/api

  登录凭据  $CRED_FILE
  环境文件  $ENV_FILE
  本次日志  $LOG_FILE

证书由 Caddy 自动续期，无需 cron。日常操作：

  cd $INSTALL_DIR
  scripts/deploy-one-click.sh --check     # 只体检
  scripts/deploy-one-click.sh --rollback  # 回滚上一版本
  scripts/ubuntu-one-click.sh status      # 容器状态
  scripts/ubuntu-one-click.sh logs        # 实时日志
EOF
}

main() {
  parse_args "$@"
  ensure_repo "$@"
  require_root "$@"

  INSTALL_DIR="${INSTALL_DIR%/}"
  DEPLOY_DIR="$INSTALL_DIR/deployments/ubuntu"
  ENV_FILE="${HONGMENG_UBUNTU_ENV:-$DEPLOY_DIR/.env.ubuntu}"
  STATE_DIR="$INSTALL_DIR/.deploy"
  CRED_FILE="$STATE_DIR/credentials.txt"
  mkdir -p "$STATE_DIR"
  LOG_FILE="$STATE_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
  # 同时写日志；进程替换不可用时退回仅终端输出，别让部署直接挂掉。
  exec 3>&1
  if ! exec > >(tee -a "$LOG_FILE") 2>&1; then
    exec >&3 2>&1
    warn "日志无法落盘（${LOG_FILE}），仅终端输出"
  fi

  printf '%s宏盟机械独立站 · 一键部署%s\n' "$C_BOLD" "$C_RESET"

  # 已有配置里的域名作为默认值（命令行优先）。
  [[ -z "$SITE_DOMAIN" ]] && SITE_DOMAIN="$(env_get SITE_DOMAIN)"
  [[ -z "$ADMIN_DOMAIN" ]] && ADMIN_DOMAIN="$(env_get ADMIN_DOMAIN)"
  [[ -z "$SERVICE_DOMAIN" ]] && SERVICE_DOMAIN="$(env_get SERVICE_DOMAIN)"
  [[ -z "$ACME_EMAIL" ]] && ACME_EMAIL="$(env_get ACME_EMAIL)"

  preflight
  if [[ ! -f /etc/apt/sources.list.hongmeng.bak ]]; then
    step "网络线路测速"
    configure_apt_mirror
  else
    APT_OPTS=(-o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15)
    log "apt 源已优选过，跳过"
  fi
  configure_docker_mirror
  install_docker
  systemctl restart docker >/dev/null 2>&1 || true
  assert_docker_versions
  ((ENABLE_MONITORING == 1)) && COMPOSE_PROFILE=(--profile monitoring)

  if [[ "$CHECK_ONLY" == 1 ]]; then ok "体检通过（未部署）"; exit 0; fi

  update_code
  detect_existing
  [[ "$DO_ROLLBACK" == 1 ]] && do_rollback

  collect_domains
  write_env_file
  open_firewall
  backup_before_upgrade
  rebuild_and_up

  if retry_health; then
    setup_backup_cron
    print_summary
    exit 0
  fi

  printf '\n%s健康检查未通过，容器保持运行以便排查%s\n' "$C_ERR" "$C_RESET" >&2
  compose ps >&2 || true
  printf '\n最近日志:\n' >&2
  compose logs --tail 40 >&2 || true
  printf '\n完整日志: %s\n' "$LOG_FILE" >&2
  exit 1
}

main "$@"
