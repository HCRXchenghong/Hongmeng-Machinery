# 宏盟机械独立站

面向海外客户的机械设备独立站，包含官网、统一控制台与在线客服三部分：官网负责商品展示与下单，控制台负责商品、订单、内容与配置，客服负责访客接待。

## 技术栈

| 模块   | 技术                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 官网   | [Astro](https://astro.build/) 7、React 19、Tailwind CSS 4、[Flowbite React](https://github.com/themesberg/flowbite-react)（MIT）、lucide-react |
| 控制台 | Vue 3、[Arco Design Vue](https://github.com/arco-design/arco-design-vue)（MIT）、Vite                                                          |
| 服务端 | Node.js、PostgreSQL、S3 兼容对象存储                                                                                                           |
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
- **系统**：邮件发送（SMTP）、登录方式、推送、AI 供应商与能力绑定。
- **访客画像**：第一方访问上报与聊天 `visitor_ref` 打通，画像卡显示浏览器、OS、设备与最近路径；国家/时区需配置公网 IP 与 GeoIP。

### 订单与支付

- 下单在 PostgreSQL 事务内读取真实价格并扣减库存，重复请求使用幂等标识，取消未付款订单回补库存。
- 订单状态：待确认、已确认、已付款、备货、发货、完成。
- 支付方式为人工确认、Stripe、PayPal。Stripe Checkout 已启用自动税费（Stripe Tax，需在 Stripe 后台完成税务登记）；退款申请在用户端 `/returns/` 提交，后台处理需超管邮箱与密码二次确认后调用 Stripe Refund。
- 注册必须邮箱验证码；游客订单可在下单后用验证码保存到账户。

### API

- `/site-admin-api/shop/*`：公开商品与下单接口。
- `/site-admin-api/commerce/*`：需要 2FA 管理员会话。
- 完整端点列于 `/openapi.json`。

## 本机运行

```bash
npm install
cp .env.example .env
npm run build:admin-web
npm run build:frontend
bash scripts/run-local-stack.sh
```

| 服务     | 地址                                |
| -------- | ----------------------------------- |
| 官网     | `http://127.0.0.1:4331/`            |
| 控制台   | `http://127.0.0.1:1338/site-admin/` |
| 客服 API | `http://127.0.0.1:8081/`            |
| 客服网页 | `http://127.0.0.1:5175/`            |

首次使用：在控制台创建管理员并绑定 2FA，然后进入「商城 → 商品库存」录入商品。默认商品目录为空，商品图片、价格、运费与服务条款需要在上线前由运营人员录入并核对。

## 内容维护位置

| 内容           | 位置                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| 英文源文案     | `frontend/src/views/Storefront.tsx`                                                  |
| 各语言兜底文案 | `frontend/src/i18n/dictionaries/`                                                    |
| 页脚社交媒体   | 后台「官网 → 页面内容 → 导航与页脚」，存于 `shop_settings.storefront_content.social` |
| SEO            | 后台「官网 → SEO 设置」，存于 `shop_settings.storefront_content.seo`                 |

页面内容、SEO 与商城数据在构建期注入；商品价格、库存与订单走实时 API。

## 生产部署

使用 `deployments/ubuntu/` 下的 Compose，单独设置域名、数据库、S3 存储、强随机密钥与站点来源。上线前按 `deployments/ubuntu/.env.ubuntu.example` 逐项核对，并按实际服务商接入税费、物流报价与邮件通知。

## 运维

- 每日备份：cron `0 2 * * *` 执行 `ASTREVA_BACKUP_DIR=/srv/astreva-backups scripts/backup-production.sh`，产出 `pg_dump` gzip 与 `.sha256`，默认保留 30 天（`ASTREVA_BACKUP_RETENTION_DAYS`）。
- 恢复演练：`scripts/restore-production.sh --yes <备份文件>`，先校验 SHA-256 与 gzip，再导入隔离库 `customer_service_restore`，不覆盖生产。
- 对象存储需在供应商侧开启 versioning 与生命周期归档，媒体不在数据库备份内。
- 告警规则与 Grafana 面板在 `deployments/ubuntu/monitoring/`。
