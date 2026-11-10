# 宏盟机械独立站

面向海外客户的机械设备独立站，包含官网、统一控制台与在线客服三部分：官网负责商品展示与下单，控制台负责商品、订单、内容与配置，客服负责访客接待。

## 技术栈

| 模块   | 技术                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 官网   | [Astro](https://astro.build/) 7、React 19、Tailwind CSS 4、[Flowbite React](https://github.com/themesberg/flowbite-react)（MIT）、lucide-react |
| 控制台 | Vue 3、[Arco Design Vue](https://github.com/arco-design/arco-design-vue)（MIT）、Vite                                                          |
| 服务端 | Node.js、PostgreSQL、Redis、内置 S3 网关（SeaweedFS）                                                                                          |
| 客服   | Go（ServiceBridge）                                                                                                                            |

官网语言为 `/` 英文、`/zh/` 中文、`/ar/` 阿拉伯语；所有语言在构建期完成服务端本地化，刷新时不会再先显示英文再切换。

## 目录

| 路径             | 内容                                  |
| ---------------- | ------------------------------------- |
| `frontend/`      | 官网前端                              |
| `admin-web/`     | 管理控制台                            |
| `admin-server/`  | 内容、商城、媒体、翻译与账号 API      |
| `servicebridge/` | 在线客服（Go 后端、访客端、坐席 App） |
| `deployments/`   | 生产部署与监控配置                    |
| `scripts/`       | 构建、备份、恢复与校验脚本            |

## 功能

### 官网

首页、关于、方案、商品列表与分类搜索、商品详情、购物车、收货信息、订单提交、联系表单、动态与政策页。商品支持图册、详情文案与按国家/地区的实时运费报价。

### 控制台

- **商城**：商品库存、订单处理、客户资料、结算与运费、支付、店铺政策各自独立页面。
- **官网**：页面内容按区块编辑，SEO 支持 AI 生成与人工逐页修改（标题、描述、关键词、分享图），AI 生图支持模型配置与 PNG/WebP 导出。
- **AI 能力**：模型配置（供应商与 API Key）、接待 AI、翻译 AI、AI 生图、调用限额、知识库。
- **系统**：系统日志、系统设置（邮件 SMTP、登录方式、推送、告警）。
- **访客画像**：第一方访问上报与聊天 `visitor_ref` 打通，画像卡显示浏览器、OS、设备与最近路径；国家/时区需配置公网 IP 与 GeoIP。

### 订单与支付

- 下单在 PostgreSQL 事务内读取真实价格并扣减库存，重复请求使用幂等标识，取消未付款订单回补库存。
- 订单状态：待确认、已确认、已付款、备货、发货、完成。
- 支付方式为人工确认、Stripe、PayPal。Stripe Checkout 已启用自动税费（Stripe Tax，需在 Stripe 后台完成税务登记）；退款申请在用户端 `/returns/` 提交，后台处理需超管邮箱与密码二次确认后调用 Stripe Refund。
- 注册必须邮箱验证码；游客订单可在下单后用验证码保存到账户。
- 商品不支持删除（接口无 DELETE），只通过「上架」开关下架，历史订单里的商品引用因此不会失效。
- 购物车与下单只依赖必要存储：拒绝可选（分析）Cookie 也能正常加购与提交订单，分析同意只影响统计与访客画像。

### API

- `/site-admin-api/shop/*`：公开商品与下单接口。
- `/site-admin-api/commerce/*`：需要 2FA 管理员会话。
- `/openapi.json` 收录公开接口与主要后台接口（67 个路径）；分析上报、多语言、部分后台 CRUD 仅在源码里，未写入文档。

## 本机运行

```bash
npm install
cp .env.example .env
bash scripts/run-local-stack.sh
```

| 服务     | 地址                                                    |
| -------- | ------------------------------------------------------- |
| 官网     | `http://127.0.0.1:4331/`                                |
| 控制台   | `http://127.0.0.1:1338/site-admin/`                     |
| 客服 API | `http://127.0.0.1:8081/`                                |
| 客服网页 | `http://127.0.0.1:5175/?api_base=http://127.0.0.1:8081` |

前置条件：Docker（脚本会起 PostgreSQL 与对象存储容器）、Node 24（生产镜像即为 24-alpine）、Python 3、Go 1.25（编译客服引擎）。第一次运行前 `cp .env.example .env`，脚本会自行构建控制台与官网。

`bash scripts/run-local-stack.sh --lan` 会把四个端口绑到 `0.0.0.0` 并按局域网 IP 生成公开地址，手机与同网段电脑可直接访问。

首次使用：访问控制台会进入「首次使用」向导，创建管理员并绑定 2FA（此时还没有任何账号，登录页的邮箱密码框用不上）。之后在「商城 → 商品库存」录入商品；商品价格、运费与服务条款上线前需运营核对。

客服回复在「宏盟客服」App 里进行（坐席账号在「客服 → 客服成员」维护）；控制台的「会话与询盘」只做查看、转接与结束会话。

## 内容维护位置

| 内容           | 位置                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| 英文源文案     | `frontend/src/views/Storefront.tsx`                                                  |
| 各语言兜底文案 | `frontend/src/i18n/dictionaries/`                                                    |
| 页脚社交媒体   | 后台「官网 → 页面内容 → 导航与页脚」，存于 `shop_settings.storefront_content.social` |
| SEO            | 后台「官网 → SEO 设置」，存于 `shop_settings.storefront_content.seo`                 |

页面内容与 SEO 在构建期注入，后台保存后会自动触发重建；商品价格、库存与订单读实时 API。英文/阿拉伯语文案来自翻译层，改完源语言建议到「多语言内容」核对。

> 不要手动 `npm run build:frontend`：`PUBLIC_ADMIN_URL` 等变量缺失时前台会回落成 `127.0.0.1:1338` 写进产物，局域网和线上客户端直接连不上（CSP 也会把这些请求拦掉）。要么用 `scripts/run-local-stack.sh`，要么显式带上 `PUBLIC_ADMIN_URL` / `PUBLIC_SITE_URL` / `PUBLIC_SERVICEBRIDGE_URL`。

`npm run check:i18n` 会比对词典键位：阿拉伯语目前仍缺 104 条（前台缺词条时显示英文），缺口被冻结在脚本的 `BASELINE` 里，只允许变小；补齐后下调即可。

## 生产部署

Ubuntu 22.04 / 24.04 上以 root 一行执行，脚本自动完成环境检查、线路测速、Docker 安装、证书签发与全量自检：

```bash
curl -fsSL https://raw.githubusercontent.com/HCRXchenghong/Hongmeng-Machinery/main/scripts/deploy-one-click.sh | sudo bash
```

`raw.githubusercontent.com` 在部分网络（含大陆）不可达，脚本自身会依次尝试镜像源；也可以直接用国内可通的线路起手：

```bash
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/HCRXchenghong/Hongmeng-Machinery/main/scripts/deploy-one-click.sh | sudo bash
```

把仓库 fork 成私有副本时，用令牌（`repo` 读权限即可，克隆也用它）：

```bash
TOKEN=ghp_xxxxxxxx
curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/HCRXchenghong/Hongmeng-Machinery/contents/scripts/deploy-one-click.sh?ref=main" \
  | sudo HONGMENG_TOKEN="$TOKEN" bash
```

少了 `Accept: application/vnd.github.raw` 拿到的是 JSON，管道给 bash 会直接报语法错。

````

执行前把三个域名的 A 记录指向本机，运行中会询问域名与证书邮箱。脚本会：

- 体检系统版本、架构、CPU/内存/磁盘、80/443 占用与系统时钟；
- 对 apt 源、Docker 镜像、代码下载逐条测速，走最快的直连或镜像；
- 自动安装 / 升级 Docker 与 compose，再拉取代码并构建；
- 已有部署则原地升级：数据卷保留，容器按新代码重建，升级前自动备份数据库；
- 签发 Let's Encrypt 证书，之后由 Caddy 自动续期；
- 逐项检查前后台、客服、接口、素材存储与证书，全部正常才以 0 退出，否则保留容器并打印日志。

常用参数：

| 参数                                               | 说明                                                          |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `--domain` / `--admin-domain` / `--service-domain` | 三个域名，配合 `--yes` 可全自动                               |
| `--email`                                          | 证书通知邮箱                                                  |
| `--dir`                                            | 安装目录，默认 `/opt/hongmeng-machinery`（或 `HONGMENG_DIR`） |
| `--token`                                          | 私有仓库令牌（或 `HONGMENG_TOKEN`）                           |
| `--ref`                                            | 指定 tag，默认 main；传分支名会回落到 main                    |
| `--check`                                          | 只体检不部署，但**仍会改写 apt 源并安装/重启 Docker**         |
| `--rollback`                                       | 回滚到上次部署前的提交（不等于「上一个成功版本」）            |
| `--monitoring`                                     | 附带 Prometheus + Grafana，仅监听 `127.0.0.1:9090/3000`       |
| `--no-backup`                                      | 升级前不备份                                                  |
| `--skip-docker-install`                            | 跳过 Docker 安装（要求已具备）                                |

只有域名、证书邮箱、安装目录与令牌支持环境变量（`SITE_DOMAIN` / `ADMIN_DOMAIN` / `SERVICE_DOMAIN` / `ACME_EMAIL` / `HONGMENG_DIR` / `HONGMENG_TOKEN`），其余只能走参数。

首次运行会把账号写到 `/opt/hongmeng-machinery/.deploy/credentials.txt`（600），但里面**不是 CMS 后台密码**：

- `superadmin` / 坐席密码：给客服引擎与客服 App 用；
- CMS 控制台第一次打开是「首次使用」向导，由你现场创建管理员并绑 2FA，之后再改密用 `node scripts/reset-admin.mjs <邮箱> <新密码>`。

## 运维

**备份**：一键脚本在健康检查全绿后才写入每日 02:00 的 cron，产物在 `/opt/hongmeng-machinery/.deploy/backups`（`pg_dump` gzip + `.sha256`），默认保留 30 天（`ASTREVA_BACKUP_RETENTION_DAYS`，该前缀为历史变量名）。

**恢复**：`bash scripts/restore-production.sh [--yes] <备份文件>` 必须在安装目录执行，且要求同名 `.sha256` 文件在旁边。默认导入隔离库 `customer_service_restore` 做演练；要覆盖生产库需额外加 `--force-production` 并交互输入库名与 `RESTORE PRODUCTION`。

**素材存储**：默认用内置对象存储（`s3-data` 卷，经 Caddy 在后台域名暴露 `/hongmeng-site-media`）。换外部 S3 / R2 时改 `.env.ubuntu` 的 `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`、`S3_PUBLIC_BASE_URL`，然后**不要再跑一键脚本**（它会把 `S3_*` 按内置存储重写），只重建后台容器：

```bash
docker compose -f deployments/ubuntu/docker-compose.ubuntu.yml \
  --env-file deployments/ubuntu/.env.ubuntu up -d admin-server
````

**环境文件**：`.env.ubuntu` 由脚本按模板重写，只沿用数据库/2FA/webhook/metrics/S3 密钥这几项；自定义变量（`OPENAI_*`、`RATE_LIMIT_*` 等）重跑后需要复核。

**上线前必须配 SMTP**（系统 → 系统设置 → 邮件）：注册与「把游客订单存到账户」都要邮箱验证码，没配时接口返回 503。

**客服**：坐席回复在「宏盟客服」App 内完成；控制台只做查看、转接与结束会话。

**内容发布**：在「官网 → 页面内容 / SEO 设置」保存后会触发前台重建（约 30–60 秒）。英文与阿拉伯语走翻译层，改完中文需在「官网 → 多语言内容」核对或重新翻译。

**监控**：`--monitoring` 启用 Prometheus 与 Grafana（仅回环监听），规则与面板在 `deployments/ubuntu/monitoring/`。

**安全响应头**：Caddy 给官网与后台都加了 HSTS / nosniff / Referrer-Policy / Permissions-Policy / X-Frame-Options；官网另有一条 CSP（script/style 允许 inline 以兼容 Astro 的内联 hydration，iframe 只放客服与视频站）。本地 `scripts/static-server.mjs` 发同一套头，便于在开发机验证 CSP 不会打断页面。
