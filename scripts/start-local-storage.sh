#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 .env；请先复制并填写 .env.example。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for key in DATABASE_URL CMS_STORE_DRIVER ADMIN_MEDIA_DRIVER S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE_URL; do
  if [[ -z "${!key:-}" ]]; then
    echo "缺少 $key" >&2
    exit 1
  fi
done
if [[ "$CMS_STORE_DRIVER" != "postgres" || "$ADMIN_MEDIA_DRIVER" != "s3" ]]; then
  echo "本地存储必须使用 PostgreSQL 和 S3 兼容对象存储。" >&2
  exit 1
fi

db_password="${DATABASE_URL#postgres://hongmeng_cms:}"
db_password="${db_password%%@*}"

if ! docker inspect hongmeng-cms-postgres >/dev/null 2>&1; then
  docker run -d --name hongmeng-cms-postgres --restart unless-stopped \
    -p 127.0.0.1:${POSTGRES_HOST_PORT:-55435}:5432 \
    -e POSTGRES_DB=hongmeng_cms \
    -e POSTGRES_USER=hongmeng_cms \
    -e POSTGRES_PASSWORD="$db_password" \
    -v hongmeng-cms-postgres-data:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
else
  docker start hongmeng-cms-postgres >/dev/null
fi

# MinIO 官方镜像已从 Docker Hub 下架，本机对象存储改用 SeaweedFS 的 S3 网关（与生产一致）。
if ! docker inspect hongmeng-cms-s3 >/dev/null 2>&1; then
  docker run -d --name hongmeng-cms-s3 --restart unless-stopped \
    -p 127.0.0.1:${MINIO_API_PORT:-10016}:9000 \
    -p 127.0.0.1:${MINIO_CONSOLE_PORT:-10017}:8888 \
    -v hongmeng-cms-s3-data:/data \
    chrislusf/seaweedfs:latest mini -dir=/data -ip.bind=0.0.0.0 -s3 -s3.port=9000 -bucket="$S3_BUCKET" >/dev/null
else
  docker start hongmeng-cms-s3 >/dev/null
fi

for _ in $(seq 1 30); do
  docker exec hongmeng-cms-postgres pg_isready -U hongmeng_cms -d hongmeng_cms >/dev/null 2>&1 && break
  sleep 1
done
docker exec hongmeng-cms-postgres pg_isready -U hongmeng_cms -d hongmeng_cms >/dev/null

# Go 客服引擎用自己的库：它的 ensureCoreTables 会建 conversations/messages/sessions 等表，
# 与后台 CMS 的表混在同一个库里容易重名冲突，因此单独建 hongmeng_engine（幂等）。
if ! docker exec hongmeng-cms-postgres psql -U hongmeng_cms -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='hongmeng_engine'" | grep -q 1; then
  echo "创建客服引擎数据库 hongmeng_engine（AI 供应商/绑定等数据持久化到这里）..."
  docker exec hongmeng-cms-postgres psql -U hongmeng_cms -d postgres -c "CREATE DATABASE hongmeng_engine" >/dev/null
fi

for _ in $(seq 1 30); do
  curl -fsS "$S3_ENDPOINT/" >/dev/null && break
  sleep 1
done
curl -fsS "$S3_ENDPOINT/" >/dev/null

cd "$ROOT_DIR"
node --input-type=module <<'NODE'
import { CreateBucketCommand, PutBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
});
const bucket = process.env.S3_BUCKET;
try { await client.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) {
  if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error;
}
// SeaweedFS 默认匿名可读，策略写不进去也不算错。
try {
  await client.send(new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'PublicReadSiteMedia', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }] })
  }));
} catch (error) {
  console.warn(`对象存储策略未写入（${error.name}），匿名读通常仍然可用。`);
}
NODE

echo "本地 PostgreSQL 和对象存储已就绪。"
