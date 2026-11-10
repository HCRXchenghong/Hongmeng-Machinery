<template>
  <div class="commerce-manage">
    <a-page-header :show-back="false" :title="sectionMeta.title" :subtitle="sectionMeta.subtitle" />
    <a-alert type="info" class="mb-4">{{ sectionMeta.hint }}</a-alert>
    <div class="section-shell">
      <section v-if="section === 'products'" class="section-page">
        <a-card :bordered="false">
          <template #extra><a-space><a-button @click="refresh">刷新</a-button><a-button type="primary" @click="newProduct">新增商品</a-button></a-space></template>
          <a-table :data="products" :loading="loading" row-key="id" :pagination="{ pageSize: 12 }" :scroll="{ x: 1000 }">
            <template #columns>
              <a-table-column title="商品" :width="260"><template #cell="{ record }"><a-space><img v-if="record.image_url" :src="record.image_url" class="thumb" /><span>{{ record.name }}</span></a-space></template></a-table-column>
              <a-table-column title="SKU" data-index="sku" :width="150" />
              <a-table-column title="价格" :width="110"><template #cell="{ record }">{{ money(record.price_cents, record.currency) }}</template></a-table-column>
              <a-table-column title="库存" data-index="stock" :width="90" />
              <a-table-column title="状态" :width="100"><template #cell="{ record }"><a-tag :color="record.active ? 'green' : 'gray'">{{ record.active ? '上架' : '草稿' }}</a-tag></template></a-table-column>
              <a-table-column title="操作" :width="100"><template #cell="{ record }"><a-link @click="editProduct(record)">编辑</a-link></template></a-table-column>
            </template>
          </a-table>
        </a-card>
      </section>
      <section v-if="section === 'orders'" class="section-page">
        <a-card :bordered="false"><template #extra><a-button @click="refresh">刷新</a-button></template>
          <a-table :data="orders" :loading="loading" row-key="id" :pagination="{ pageSize: 12 }" :scroll="{ x: 1150 }">
            <template #columns>
              <a-table-column title="订单号" data-index="order_number" :width="210" />
              <a-table-column title="下单时间" :width="180"><template #cell="{ record }">{{ date(record.created_at) }}</template></a-table-column>
              <a-table-column title="客户" :width="130"><template #cell="{ record }">{{ record.customer_name }}<br />{{ record.phone }}</template></a-table-column>
              <a-table-column title="金额" :width="160"><template #cell="{ record }"><span v-if="record.shipping_status === 'quote_pending'">{{ money(record.subtotal_cents, record.currency) }}（商品小计，待报价）</span><span v-else-if="record.shipping_status === 'collect'">{{ money(record.total_cents, record.currency) }} + 运费到付</span><span v-else>{{ money(record.total_cents, record.currency) }}</span></template></a-table-column>
              <a-table-column title="状态" :width="180"><template #cell="{ record }"><a-space direction="vertical" :size="2"><span>{{ record.shipping_status === 'quote_pending' ? '待运费报价' : record.shipping_status === 'quoted' && !record.shipping_accepted_at ? '待客户接受运费' : statusLabel(record.status) }}</span><a-tag v-if="record.refund_request" color="red" size="small">退款待处理</a-tag><a-tag v-else-if="record.payment_status === 'refunded'" color="gray" size="small">已退款</a-tag><a-tag v-else-if="record.payment_status === 'partially_refunded'" color="orange" size="small">部分退款</a-tag></a-space></template></a-table-column>
              <a-table-column title="操作" :width="110"><template #cell="{ record }"><a-link @click="editOrder(record)">查看处理</a-link></template></a-table-column>
            </template>
          </a-table>
        </a-card>
      </section>
      <section v-if="section === 'customers'" class="section-page">
        <a-card :bordered="false"><template #extra><a-button @click="refresh">刷新</a-button></template><a-table :data="customers" :loading="loading" row-key="id" :pagination="{ pageSize: 12 }" :scroll="{ x: 1000 }"><template #columns>
          <a-table-column title="客户" :width="220"><template #cell="{ record }">{{ record.full_name }}<br /><small>{{ record.email }}</small></template></a-table-column>
          <a-table-column title="电话" data-index="phone" :width="150" />
          <a-table-column title="实名状态" :width="110"><template #cell="{ record }"><a-tag>{{ record.verification_status === 'verified' ? '已验证' : '未验证' }}</a-tag></template></a-table-column>
          <a-table-column title="订单数" data-index="order_count" :width="90" />
          <a-table-column title="已付款金额" :width="130"><template #cell="{ record }">{{ paidTotalsLabel(record.paid_totals) }}</template></a-table-column>
          <a-table-column title="注册时间" :width="180"><template #cell="{ record }">{{ date(record.created_at) }}</template></a-table-column>
          <a-table-column title="操作" :width="100"><template #cell="{ record }"><a-link @click="editCustomer(record)">查看/编辑</a-link></template></a-table-column>
        </template></a-table></a-card>
      </section>
      <section v-if="section === 'settings'" class="section-page">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="16">
            <a-card :bordered="false" title="结算基础" class="settlement-card">
              <a-form :model="settings" layout="vertical">
                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="店铺结算货币">
                      <a-select v-model="settings.currency">
                        <a-option value="USD">美元 USD</a-option>
                        <a-option value="CNY">人民币 CNY</a-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="允许提交订单">
                      <a-switch v-model="settings.checkout_enabled" />
                      <template #extra>关闭后前台只能浏览，不能提交订单。</template>
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-form-item label="订单咨询邮箱">
                  <a-input v-model="settings.support_email" placeholder="orders@example.com" />
                  <template #extra>订单通知与客户咨询使用这个邮箱，不用于登录。</template>
                </a-form-item>
              </a-form>
            </a-card>

            <a-card :bordered="false" title="地区运费" class="settlement-card">
              <a-alert type="info" class="mb-3">按收货国家匹配运费；命中地区的规则优先于下方全局规则。国家请填 ISO 两位代码（如 US, CA, AE），不匹配时使用全局规则。</a-alert>
              <div v-for="(zone, index) in settings.shipping_zones" :key="zone.id" class="shipping-zone-row">
                <a-row :gutter="10" align="center">
                  <a-col :xs="24" :md="5"><a-input v-model="zone.name" placeholder="地区名称，如 美国" /></a-col>
                  <a-col :xs="24" :md="5"><a-input v-model="zone.countriesText" placeholder="US, CA" /></a-col>
                  <a-col :xs="12" :md="3"><a-select v-model="zone.mode"><a-option value="flat">固定运费</a-option><a-option value="quote">人工报价</a-option></a-select></a-col>
                  <a-col :xs="12" :md="3"><a-input-number :model-value="zone.amount_cents / 100" :min="0" :precision="2" :disabled="zone.mode === 'quote'" style="width: 100%" @change="(value) => (zone.amount_cents = Math.round(Number(value || 0) * 100))" /></a-col>
                  <a-col :xs="8" :md="2"><a-switch v-model="zone.active" /></a-col>
                  <a-col :xs="8" :md="2"><a-button size="small" status="danger" @click="removeShippingZone(index)">删除</a-button></a-col>
                </a-row>
              </div>
              <a-empty v-if="!settings.shipping_zones.length" description="尚未配置地区运费，所有国家使用全局规则" />
              <a-button type="dashed" long class="mt-3" @click="addShippingZone">新增地区运费</a-button>
            </a-card>

            <a-card :bordered="false" title="全局运费规则" class="settlement-card">
              <a-form :model="settings" layout="vertical">
                <a-form-item label="运费方式">
                  <a-select v-model="settings.shipping_mode">
                    <a-option value="quote">按地址人工报价</a-option>
                    <a-option value="flat">固定运费</a-option>
                  </a-select>
                </a-form-item>
                <a-form-item v-if="settings.shipping_mode === 'flat'" label="固定运费（店铺货币）">
                  <a-input-number v-model="shippingAmount" :min="0" :precision="2" style="width: 220px" />
                </a-form-item>
                <a-alert v-else type="info" show-icon>
                  客户先提交订单请求；客服在「订单处理」中录入运费并确认后，订单金额才成为应付总额。
                </a-alert>
              </a-form>
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="8">
            <a-card :bordered="false" title="当前状态" class="settlement-status">
              <a-descriptions :column="1" size="small">
                <a-descriptions-item label="店铺货币">{{ settings.currency }}</a-descriptions-item>
                <a-descriptions-item label="运费方式">
                  {{ settings.shipping_mode === 'flat' ? '固定运费' : '按地址人工报价' }}
                </a-descriptions-item>
                <a-descriptions-item label="下单状态">
                  {{ settings.checkout_enabled ? '允许提交订单' : '已关闭下单' }}
                </a-descriptions-item>
                <a-descriptions-item label="支付方式">
                  在「商城 → 支付」中配置
                </a-descriptions-item>
              </a-descriptions>
              <a-divider />
              <a-typography-text type="secondary">
                修改币种会影响商品展示与已有订单；修改运费规则只影响新订单。支付密钥不在这里维护。
              </a-typography-text>
              <a-button class="status-link" @click="router.push('/store/payments')">前往支付配置</a-button>
            </a-card>
          </a-col>
        </a-row>

        <div class="section-save-bar">
          <a-button type="primary" :loading="saving" @click="saveSettings">保存结算与运费</a-button>
        </div>
      </section>
      <section v-if="section === 'integrations'" class="section-page">
        <a-alert type="warning" class="mb-4">凭据会加密保存在 CMS 数据库。需配置 HTTPS 域名、支付服务商商户账号及回调地址后，才可在生产环境收款。</a-alert>
        <a-card title="收款方式" class="integration-card">
          <a-form :model="settings" layout="vertical">
            <a-form-item label="当前收款方式">
              <a-select v-model="settings.payment_provider" style="max-width: 320px">
                <a-option value="manual">人工确认</a-option>
                <a-option value="stripe">Stripe</a-option>
                <a-option value="paypal">PayPal</a-option>
              </a-select>
            </a-form-item>
            <a-alert v-if="settings.payment_provider !== 'manual' && !settings.payment_configured" type="warning" show-icon>
              未检测到该服务商商户凭据，在线付款暂不可用。请先在下方填写并保存密钥。
            </a-alert>
            <a-alert v-else-if="settings.payment_provider !== 'manual' && settings.currency !== 'USD'" type="warning" show-icon>
              Stripe 与 PayPal 线上结算当前按 USD 实现，请到「结算与运费」把店铺和商品货币统一为 USD。
            </a-alert>
            <a-alert v-else-if="settings.payment_provider !== 'manual'" type="success" show-icon>
              {{ settings.payment_provider }} 密钥与 Webhook 已配置。启用正式收款前请在 Sandbox 完成联调。
            </a-alert>
            <a-button type="primary" :loading="saving" @click="saveSettings">保存收款方式</a-button>
          </a-form>
        </a-card>
        <a-alert type="info" class="mb-4">Stripe Checkout 已启用自动税费（Stripe Tax）：税额按客户账单地址计算，并写入订单的税费字段。请先在 Stripe 后台开通 Tax、配置公司地址与税务登记；PayPal/人工确认不自动计税。</a-alert>
        <a-card title="Stripe" class="integration-card">
          <a-tag :color="integrations.stripe_configured ? 'green' : 'gray'">{{ integrations.stripe_configured ? '已配置' : '待配置' }}</a-tag>
          <a-input-password v-model="paymentSecrets.stripeSecret" placeholder="Stripe Secret Key（留空保留现有值）" class="mt-4" />
          <a-input-password v-model="paymentSecrets.stripeWebhookSecret" placeholder="Stripe Webhook Signing Secret" class="mt-4" />
          <p class="integration-help">Stripe Webhook URL：/site-admin-api/shop/webhooks/stripe。请订阅 checkout.session.completed、checkout.session.async_payment_succeeded、checkout.session.async_payment_failed 和 charge.refunded。</p>
        </a-card>
        <a-card title="PayPal" class="integration-card">
          <a-tag :color="integrations.paypal_configured ? 'green' : 'gray'">{{ integrations.paypal_configured ? '已配置' : '待配置' }}</a-tag>
          <a-select v-model="paymentSecrets.paypalMode" class="mt-4"><a-option value="sandbox">Sandbox 测试</a-option><a-option value="live">Live 正式收款</a-option></a-select>
          <a-input-password v-model="paymentSecrets.paypalClientId" placeholder="PayPal Client ID" class="mt-4" />
          <a-input-password v-model="paymentSecrets.paypalClientSecret" placeholder="PayPal Client Secret" class="mt-4" />
          <a-input-password v-model="paymentSecrets.paypalWebhookId" placeholder="PayPal Webhook ID" class="mt-4" />
          <p class="integration-help">PayPal Webhook URL：/site-admin-api/shop/webhooks/paypal。订阅 PAYMENT.CAPTURE.COMPLETED、PAYMENT.CAPTURE.DENIED、PAYMENT.CAPTURE.REFUNDED，并将服务商返回的 Webhook ID 填入上方。</p>
        </a-card>
        <a-button type="primary" :loading="saving" @click="saveIntegrations">加密保存凭据</a-button>
      </section>
      <section v-if="section === 'policies'" class="section-page">
        <a-card class="policy-card"><a-form layout="vertical"><a-form-item label="隐私政策"><a-textarea v-model="policies.privacy_policy" :auto-size="{ minRows: 12, maxRows: 32 }" /></a-form-item><a-form-item label="Cookie 政策"><a-textarea v-model="policies.cookie_policy" :auto-size="{ minRows: 8, maxRows: 24 }" /></a-form-item><a-form-item label="销售条款"><a-textarea v-model="policies.terms_policy" :auto-size="{ minRows: 12, maxRows: 32 }" /></a-form-item><a-form-item label="配送政策"><a-textarea v-model="policies.shipping_policy" :auto-size="{ minRows: 8, maxRows: 24 }" /></a-form-item><a-form-item label="退货与退款政策"><a-textarea v-model="policies.returns_policy" :auto-size="{ minRows: 8, maxRows: 24 }" /></a-form-item><a-button type="primary" :loading="saving" @click="savePolicies">保存政策内容</a-button></a-form></a-card>
      </section>
      <section v-if="section === 'content'" class="section-page">
        <div class="content-editor">
          <aside class="content-editor-nav">
            <strong>页面区块</strong>
            <button
              v-for="item in contentSections"
              :key="item.key"
              type="button"
              :class="{ active: contentSection === item.key }"
              @click="selectContentSection(item.key)"
            >
              {{ item.label }}
            </button>
          </aside>
          <div class="content-editor-panel">
          <div class="content-editor-toolbar">
            <a-typography-text type="secondary">当前只编辑一个区块，保存后前台实时读取。</a-typography-text>
            <a-button type="primary" :loading="saving" @click="saveStorefrontContent">保存页面内容</a-button>
          </div>
        <a-card v-if="contentSection === 'brand'" title="品牌与公告" class="policy-card"><a-form layout="vertical"><a-row :gutter="16"><a-col :span="12"><a-form-item label="品牌名称"><a-input v-model="storefrontContent.brand.name" /></a-form-item></a-col><a-col :span="12"><a-form-item label="品牌副标题"><a-input v-model="storefrontContent.brand.tagline" /></a-form-item></a-col></a-row><a-form-item label="Logo 图片地址（HTTPS 或站内路径）"><MediaPicker v-model="storefrontContent.brand.logo" media-type="image" accept="image/*" /></a-form-item><a-form-item label="顶部公告"><a-input v-model="storefrontContent.announcement.text" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="公告按钮文字"><a-input v-model="storefrontContent.announcement.cta" /></a-form-item></a-col><a-col :span="12"><a-form-item label="公告按钮链接"><a-input v-model="storefrontContent.announcement.ctaHref" /></a-form-item></a-col></a-row></a-form></a-card>
        <a-card v-if="contentSection === 'nav'" title="导航与页脚" class="policy-card"><a-form layout="vertical"><a-row :gutter="16"><a-col :span="8"><a-form-item label="首页导航文字"><a-input v-model="storefrontContent.navigation.homeLabel" /></a-form-item></a-col><a-col :span="8"><a-form-item label="关于导航文字"><a-input v-model="storefrontContent.navigation.aboutLabel" /></a-form-item></a-col><a-col :span="8"><a-form-item label="商品导航文字"><a-input v-model="storefrontContent.navigation.productsLabel" /></a-form-item></a-col><a-col :span="8"><a-form-item label="方案导航文字"><a-input v-model="storefrontContent.navigation.solutionsLabel" /></a-form-item></a-col><a-col :span="8"><a-form-item label="联系导航文字"><a-input v-model="storefrontContent.navigation.contactLabel" /></a-form-item></a-col></a-row><a-form-item label="页脚介绍"><a-textarea v-model="storefrontContent.footer.description" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="快速链接标题"><a-input v-model="storefrontContent.footer.quickLinksTitle" /></a-form-item></a-col><a-col :span="12"><a-form-item label="服务栏标题"><a-input v-model="storefrontContent.footer.supportTitle" /></a-form-item></a-col><a-col :span="12"><a-form-item label="帮助栏标题"><a-input v-model="storefrontContent.footer.helpTitle" /></a-form-item></a-col><a-col :span="12"><a-form-item label="帮助栏说明"><a-input v-model="storefrontContent.footer.helpText" /></a-form-item></a-col><a-col :span="12"><a-form-item label="配送政策链接文字"><a-input v-model="storefrontContent.footer.shippingLabel" /></a-form-item></a-col><a-col :span="12"><a-form-item label="退货政策链接文字"><a-input v-model="storefrontContent.footer.returnsLabel" /></a-form-item></a-col></a-row>
<a-divider>社交媒体账号（留空则不显示对应图标）</a-divider>
<a-alert type="info" class="mb-3">请填写完整链接，例如 https://www.tiktok.com/@yourname、https://www.facebook.com/yourpage、https://wa.me/8613800000000。只允许 http/https 链接。</a-alert>
<a-row :gutter="16">
  <a-col :span="8"><a-form-item label="TikTok"><a-input v-model="storefrontContent.social.tiktok" placeholder="https://www.tiktok.com/@..." /></a-form-item></a-col>
  <a-col :span="8"><a-form-item label="Facebook"><a-input v-model="storefrontContent.social.facebook" placeholder="https://www.facebook.com/..." /></a-form-item></a-col>
  <a-col :span="8"><a-form-item label="Instagram"><a-input v-model="storefrontContent.social.instagram" placeholder="https://www.instagram.com/..." /></a-form-item></a-col>
  <a-col :span="8"><a-form-item label="X（Twitter）"><a-input v-model="storefrontContent.social.x" placeholder="https://x.com/..." /></a-form-item></a-col>
  <a-col :span="8"><a-form-item label="YouTube"><a-input v-model="storefrontContent.social.youtube" placeholder="https://www.youtube.com/@..." /></a-form-item></a-col>
  <a-col :span="8"><a-form-item label="Telegram"><a-input v-model="storefrontContent.social.telegram" placeholder="https://t.me/..." /></a-form-item></a-col>
  <a-col :span="8"><a-form-item label="WhatsApp"><a-input v-model="storefrontContent.social.whatsapp" placeholder="https://wa.me/..." /></a-form-item></a-col>
</a-row><a-button type="primary" :loading="saving" @click="saveStorefrontContent">保存导航与页脚</a-button></a-form></a-card><a-card v-if="contentSection === 'home'" title="首页" class="policy-card"><a-form layout="vertical"><a-form-item label="首屏眉题"><a-input v-model="storefrontContent.home.eyebrow" /></a-form-item><a-form-item label="首屏标题"><a-textarea v-model="storefrontContent.home.title" /></a-form-item><a-form-item label="首屏说明"><a-textarea v-model="storefrontContent.home.subtitle" /></a-form-item><a-form-item label="首屏图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.home.heroMedia" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="主按钮文字"><a-input v-model="storefrontContent.home.cta" /></a-form-item></a-col><a-col :span="12"><a-form-item label="主按钮链接"><a-input v-model="storefrontContent.home.ctaHref" /></a-form-item></a-col></a-row><a-divider>首页服务卖点（显示四项）</a-divider><a-row :gutter="16"><a-col v-for="(benefit, index) in storefrontContent.home.benefits" :key="index" :span="12"><a-form-item :label="`卖点 ${index + 1} 标题`"><a-input v-model="benefit.title" /></a-form-item><a-form-item :label="`卖点 ${index + 1} 说明`"><a-textarea v-model="benefit.description" /></a-form-item></a-col></a-row><a-divider>介绍区</a-divider><a-form-item label="眉题"><a-input v-model="storefrontContent.home.introEyebrow" /></a-form-item><a-form-item label="介绍标题"><a-textarea v-model="storefrontContent.home.introTitle" /></a-form-item><a-form-item label="介绍文字"><a-textarea v-model="storefrontContent.home.introDescription" /></a-form-item><a-form-item label="介绍区图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.home.introMedia" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="按钮文字"><a-input v-model="storefrontContent.home.introCta" /></a-form-item></a-col><a-col :span="12"><a-form-item label="按钮链接"><a-input v-model="storefrontContent.home.introCtaHref" /></a-form-item></a-col></a-row><a-divider>现场特色区</a-divider><a-form-item label="眉题"><a-input v-model="storefrontContent.home.featureEyebrow" /></a-form-item><a-form-item label="特色区标题"><a-textarea v-model="storefrontContent.home.featureTitle" /></a-form-item><a-form-item label="特色区文字"><a-textarea v-model="storefrontContent.home.featureDescription" /></a-form-item><a-form-item label="特色区图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.home.featureMedia" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="按钮文字"><a-input v-model="storefrontContent.home.featureCta" /></a-form-item></a-col><a-col :span="12"><a-form-item label="按钮链接"><a-input v-model="storefrontContent.home.featureCtaHref" /></a-form-item></a-col></a-row><a-divider>精选商品标题区</a-divider><a-form-item label="眉题"><a-input v-model="storefrontContent.home.featuredEyebrow" /></a-form-item><a-form-item label="标题"><a-input v-model="storefrontContent.home.featuredTitle" /></a-form-item><a-form-item label="说明"><a-textarea v-model="storefrontContent.home.featuredDescription" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="目录链接文字"><a-input v-model="storefrontContent.home.featuredLinkLabel" /></a-form-item></a-col><a-col :span="12"><a-form-item label="目录链接"><a-input v-model="storefrontContent.home.featuredHref" /></a-form-item></a-col></a-row><a-divider>首页底部行动区</a-divider><a-form-item label="眉题"><a-input v-model="storefrontContent.home.bottomEyebrow" /></a-form-item><a-form-item label="标题"><a-input v-model="storefrontContent.home.bottomTitle" /></a-form-item><a-form-item label="说明"><a-textarea v-model="storefrontContent.home.bottomDescription" /></a-form-item><a-form-item label="背景图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.home.bottomMedia" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="按钮文字"><a-input v-model="storefrontContent.home.bottomCta" /></a-form-item></a-col><a-col :span="12"><a-form-item label="按钮链接"><a-input v-model="storefrontContent.home.bottomCtaHref" /></a-form-item></a-col></a-row></a-form></a-card>
        <a-card v-if="contentSection === 'solutions'" title="应用方案页面" class="policy-card"><a-form layout="vertical"><a-form-item label="眉题"><a-input v-model="storefrontContent.solutions.eyebrow" /></a-form-item><a-form-item label="标题"><a-input v-model="storefrontContent.solutions.title" /></a-form-item><a-form-item label="页面说明"><a-textarea v-model="storefrontContent.solutions.description" /></a-form-item><a-form-item label="首屏图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.solutions.heroMedia" /></a-form-item><a-divider>方案列表（可新增、编辑、删除和排序）</a-divider><div v-for="(item, index) in storefrontContent.solutions.items" :key="`solution-${index}`" class="solution-editor-card"><div class="solution-editor-heading"><strong>方案 {{ index + 1 }}</strong><a-space><a-button size="mini" :disabled="index === 0" @click="moveSolution(index, -1)">上移</a-button><a-button size="mini" :disabled="index === storefrontContent.solutions.items.length - 1" @click="moveSolution(index, 1)">下移</a-button><a-button size="mini" status="danger" @click="removeSolution(index)">删除方案</a-button></a-space></div><a-row :gutter="16"><a-col :span="12"><a-form-item label="方案标题"><a-input v-model="item.title" /></a-form-item></a-col><a-col :span="12"><a-form-item label="眉题（可选）"><a-input v-model="item.eyebrow" /></a-form-item></a-col></a-row><a-form-item label="方案说明"><a-textarea v-model="item.description" /></a-form-item><a-form-item label="卡片图片 / 视频轮播"><MediaSequenceEditor v-model="item.media" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="按钮文字"><a-input v-model="item.linkLabel" /></a-form-item></a-col><a-col :span="12"><a-form-item label="按钮链接"><a-input v-model="item.linkHref" placeholder="/contact/" /></a-form-item></a-col></a-row></div><a-button type="dashed" long @click="addSolution">新增应用方案</a-button><a-form-item label="底部行动标题"><a-input v-model="storefrontContent.solutions.bottomTitle" /></a-form-item><a-form-item label="底部行动说明"><a-textarea v-model="storefrontContent.solutions.bottomDescription" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="底部按钮文字"><a-input v-model="storefrontContent.solutions.bottomCta" /></a-form-item></a-col><a-col :span="12"><a-form-item label="底部按钮链接"><a-input v-model="storefrontContent.solutions.bottomHref" /></a-form-item></a-col></a-row><a-button type="primary" :loading="saving" @click="saveStorefrontContent">保存应用方案页面</a-button></a-form></a-card><a-card v-if="contentSection === 'pages'" title="关于、商品目录、联系和动态页面" class="policy-card"><a-form layout="vertical"><a-divider>关于我们</a-divider><a-form-item label="眉题"><a-input v-model="storefrontContent.about.eyebrow" /></a-form-item><a-form-item label="标题"><a-input v-model="storefrontContent.about.title" /></a-form-item><a-form-item label="说明"><a-textarea v-model="storefrontContent.about.description" /></a-form-item><a-form-item label="正文"><a-textarea v-model="storefrontContent.about.body" :auto-size="{ minRows: 4, maxRows: 12 }" /></a-form-item><a-row :gutter="16"><a-col :span="12"><a-form-item label="首屏背景图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.about.heroMedia" /></a-form-item></a-col><a-col :span="12"><a-form-item label="介绍区图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.about.contentMedia" /></a-form-item></a-col></a-row><a-row :gutter="16"><a-col :span="8"><a-form-item label="咨询按钮"><a-input v-model="storefrontContent.about.ctaLabel" /></a-form-item></a-col><a-col :span="8"><a-form-item label="咨询按钮链接"><a-input v-model="storefrontContent.about.ctaHref" /></a-form-item></a-col><a-col :span="8"><a-form-item label="底部行动按钮"><a-input v-model="storefrontContent.about.finalCta" /></a-form-item></a-col></a-row><a-form-item label="底部行动标题"><a-input v-model="storefrontContent.about.finalTitle" /></a-form-item><a-divider>商品目录</a-divider><a-form-item label="眉题"><a-input v-model="storefrontContent.shop.eyebrow" /></a-form-item><a-form-item label="页面标题"><a-input v-model="storefrontContent.shop.title" /></a-form-item><a-form-item label="页面说明"><a-textarea v-model="storefrontContent.shop.description" /></a-form-item><a-form-item label="无商品提示"><a-input v-model="storefrontContent.shop.emptyMessage" /></a-form-item><a-divider>联系我们</a-divider><a-form-item label="页面标题"><a-input v-model="storefrontContent.contact.title" /></a-form-item><a-form-item label="页面说明"><a-textarea v-model="storefrontContent.contact.description" /></a-form-item><a-form-item label="侧栏标题"><a-textarea v-model="storefrontContent.contact.sideTitle" /></a-form-item><a-form-item label="侧栏说明"><a-textarea v-model="storefrontContent.contact.sideDescription" /></a-form-item><a-form-item label="侧栏图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.contact.media" /></a-form-item><a-divider>最新动态</a-divider><a-form-item label="页面眉题"><a-input v-model="storefrontContent.news.eyebrow" /></a-form-item><a-form-item label="页面标题"><a-input v-model="storefrontContent.news.title" /></a-form-item><a-form-item label="页面说明"><a-textarea v-model="storefrontContent.news.description" /></a-form-item><a-form-item label="动态区眉题"><a-input v-model="storefrontContent.news.storyEyebrow" /></a-form-item><a-form-item label="动态标题"><a-input v-model="storefrontContent.news.storyTitle" /></a-form-item><a-form-item label="动态正文"><a-textarea v-model="storefrontContent.news.storyDescription" /></a-form-item><a-form-item label="动态图片 / 视频轮播"><MediaSequenceEditor v-model="storefrontContent.news.media" /></a-form-item><a-form-item label="单独视频（可配置静音 / 自动播放 / YouTube 跳转）"><MediaSequenceEditor v-model="storefrontContent.news.videoMedia" /></a-form-item><a-row :gutter="16"><a-col :span="6"><a-form-item label="主按钮文字"><a-input v-model="storefrontContent.news.primaryCta" /></a-form-item></a-col><a-col :span="6"><a-form-item label="主按钮链接"><a-input v-model="storefrontContent.news.primaryHref" /></a-form-item></a-col><a-col :span="6"><a-form-item label="次按钮文字"><a-input v-model="storefrontContent.news.secondaryCta" /></a-form-item></a-col><a-col :span="6"><a-form-item label="次按钮链接"><a-input v-model="storefrontContent.news.secondaryHref" /></a-form-item></a-col></a-row><a-card title="购物车空状态媒体"><a-form-item label="购物车为空时显示的图片 / 视频"><MediaSequenceEditor v-model="storefrontContent.cart.emptyMedia" /></a-form-item></a-card><a-button type="primary" :loading="saving" @click="saveStorefrontContent">保存页面内容</a-button></a-form></a-card>
      
          </div>
        </div>
      </section>
    </div>

    <a-drawer v-model:visible="productOpen" :width="620" :title="editing.id ? '编辑商品' : '新增商品'" unmount-on-close>
      <a-form :model="editing" layout="vertical">
        <a-row :gutter="12"><a-col :span="12"><a-form-item label="商品名称"><a-input v-model="editing.name" /></a-form-item></a-col><a-col :span="12"><a-form-item label="SKU"><a-input v-model="editing.sku" /></a-form-item></a-col></a-row>
        <a-row :gutter="12"><a-col :span="12"><a-form-item label="URL 标识（小写英文）"><a-input v-model="editing.slug" /></a-form-item></a-col><a-col :span="12"><a-form-item label="分类"><a-input v-model="editing.category" /></a-form-item></a-col></a-row>
        <a-form-item label="商品简介"><a-textarea v-model="editing.summary" /></a-form-item>
        <a-form-item label="商品详情"><a-textarea v-model="editing.description" :auto-size="{ minRows: 4, maxRows: 10 }" /></a-form-item>
        <a-form-item label="商品主图">
          <div class="image-picker">
            <button v-for="image in productImageChoices" :key="image.url" type="button" class="image-choice" :class="{ selected: editing.image_url === image.url }" @click="editing.image_url = image.url">
              <img :src="image.url" :alt="image.label" /><span>{{ image.label }}</span>
            </button>
          </div>
          <MediaPicker v-model="editing.image_url" media-type="image" placeholder="上传、选择素材或粘贴 HTTPS / 站内图片地址" />
          <img v-if="editing.image_url" :src="editing.image_url" alt="当前商品主图预览" class="image-preview" />
        </a-form-item>
        <a-form-item label="商品详情图片 / 视频轮播"><MediaSequenceEditor v-model="productMediaItems" /></a-form-item>
        <a-form-item label="商品卖点（每行一条）"><a-textarea v-model="highlightsText" :auto-size="{ minRows: 2, maxRows: 5 }" /></a-form-item>
        <a-form-item label="规格参数（每行：名称 | 参数）"><a-textarea v-model="specificationsText" :auto-size="{ minRows: 3, maxRows: 8 }" placeholder="Working width | 710 mm (28.0 in)" /></a-form-item>
        <a-form-item label="商品常见问题（每行：问题 | 答案）"><a-textarea v-model="faqsText" :auto-size="{ minRows: 3, maxRows: 8 }" placeholder="What machines fit this attachment? | Confirm hydraulic and mounting specifications before purchase." /></a-form-item>
        
        <a-divider>商品运费</a-divider>
        <a-form-item label="未匹配地区时的默认规则">
          <a-select v-model="editing.shipping_rules.mode" style="max-width: 360px">
            <a-option value="inherit">使用通用运费</a-option>
            <a-option value="collect">运费到付</a-option>
            <a-option value="manual">人工再加运费</a-option>
          </a-select>
          <template #extra>商品管理里配置的规则优先；没有配置的地区按这里回退。</template>
        </a-form-item>
        <a-form-item label="按地区覆盖商品运费">
          <div v-for="(zone, index) in editing.shipping_rules.zones" :key="zone.id" class="product-shipping-zone">
            <a-row :gutter="8" align="center">
              <a-col :xs="24" :md="5"><a-input v-model="zone.name" placeholder="地区名，如 美国" /></a-col>
              <a-col :xs="24" :md="5"><a-input v-model="zone.countriesText" placeholder="US, CA" /></a-col>
              <a-col :xs="12" :md="3"><a-select v-model="zone.mode"><a-option value="flat">固定运费</a-option><a-option value="free">免运费</a-option><a-option value="collect">到付</a-option><a-option value="manual">人工加运费</a-option></a-select></a-col>
              <a-col :xs="12" :md="3"><a-input-number :model-value="zone.amount_cents / 100" :min="0" :precision="2" :disabled="zone.mode !== 'flat'" style="width: 100%" @change="(value) => (zone.amount_cents = Math.round(Number(value || 0) * 100))" /></a-col>
              <a-col :xs="8" :md="2"><a-switch v-model="zone.active" /></a-col>
              <a-col :xs="8" :md="2"><a-button size="small" status="danger" @click="removeProductShippingZone(index)">删除</a-button></a-col>
            </a-row>
          </div>
          <a-empty v-if="!editing.shipping_rules.zones.length" description="没有地区覆盖，使用默认规则" />
          <a-button type="dashed" long class="mt-2" @click="addProductShippingZone">新增商品地区运费</a-button>
        </a-form-item>
        <a-row :gutter="12"><a-col :span="8"><a-form-item label="价格货币"><a-select v-model="editing.currency"><a-option value="USD">美元 USD</a-option><a-option value="CNY">人民币 CNY</a-option></a-select></a-form-item></a-col><a-col :span="8"><a-form-item label="价格"><a-input-number v-model="priceAmount" :min="0" :precision="2" /></a-form-item></a-col><a-col :span="8"><a-form-item label="现货库存"><a-input-number v-model="editing.stock" :min="0" :precision="0" /></a-form-item></a-col></a-row>
        <a-space wrap><a-checkbox v-model="editing.active">上架</a-checkbox><a-checkbox v-model="editing.featured">首页推荐</a-checkbox><a-checkbox v-model="editing.allow_backorder">允许无现货接单（按订单安排生产或交付）</a-checkbox></a-space>
      </a-form>
      <template #footer><a-button @click="productOpen = false">取消</a-button><a-button type="primary" :loading="saving" @click="saveProduct">保存</a-button></template>
    </a-drawer>

    <a-drawer v-model:visible="orderOpen" :width="620" title="订单详情" unmount-on-close>
      <template v-if="selectedOrder">
        <a-descriptions :data="[
          { label: '订单号', value: selectedOrder.order_number },
          { label: '客户', value: selectedOrder.customer_name },
          { label: '邮箱', value: selectedOrder.email },
          { label: '电话', value: selectedOrder.phone },
          { label: '地址', value: Object.values(selectedOrder.shipping_address).join(' ') },
          { label: '备注', value: selectedOrder.note || '无' },
          { label: '商品小计', value: money(selectedOrder.subtotal_cents, selectedOrder.currency) },
          { label: '运费状态', value: selectedOrder.shipping_status === 'quote_pending' ? '待报价' : selectedOrder.shipping_status === 'quoted' ? '报价待客户接受' : selectedOrder.shipping_status === 'accepted' ? '客户已接受' : selectedOrder.shipping_status === 'collect' ? '运费到付' : '固定运费' },
          { label: '运费', value: selectedOrder.shipping_status === 'quote_pending' ? '待报价' : money(selectedOrder.shipping_cents, selectedOrder.currency) },
          { label: '税费（Stripe Tax）', value: money(selectedOrder.tax_cents || 0, selectedOrder.currency) },
          { label: '订单总额', value: selectedOrder.shipping_status === 'quote_pending' ? '运费确认后计算' : money(selectedOrder.total_cents, selectedOrder.currency) },
          { label: '已退款', value: `${money(selectedOrder.refunded_cents || 0, selectedOrder.currency)}${selectedOrder.payment_status === 'partially_refunded' ? `（剩余可退 ${money(selectedOrder.total_cents - (selectedOrder.refunded_cents || 0), selectedOrder.currency)}）` : ''}` },
          { label: '退款申请', value: selectedOrder.refund_request ? `待处理 · ${selectedOrder.refund_request.reason} · ${selectedOrder.refund_request.contact_phone}` : (selectedOrder.payment_status === 'refunded' ? `已退款${selectedOrder.refunded_by ? `（${selectedOrder.refunded_by}）` : ''}` : '无') }
        ]" :column="1" bordered />
        <a-alert v-if="selectedOrder.refund_request" type="error" show-icon class="refund-alert">
          <template #title>客户申请退款 · 待处理</template>
          原因：{{ selectedOrder.refund_request.reason }}；联系电话：{{ selectedOrder.refund_request.contact_phone }}；申请时间：{{ date(selectedOrder.refund_request.requested_at) }}
        </a-alert>
        <a-divider>商品明细</a-divider>
        <a-list :data="selectedOrder.items"><template #item="{ item }"><a-list-item>{{ item.name }} × {{ item.quantity }}　{{ money(item.line_total_cents, selectedOrder.currency) }}</a-list-item></template></a-list>
        <a-form layout="vertical" class="mt-4"><a-form-item v-if="selectedOrder.shipping_status === 'quote_pending'" label="填写运费报价（店铺货币）"><a-input-number v-model="shippingQuoteAmount" :min="0" :precision="2" /><template #extra>保存报价后会自动重算订单总额；确认或发货前必须先填写报价。</template></a-form-item><a-form-item v-else label="已确认运费"><a-tag color="green">{{ money(selectedOrder.shipping_cents, selectedOrder.currency) }}</a-tag></a-form-item><a-form-item label="订单状态"><a-select v-model="orderStatus"><a-option v-for="value in statuses" :key="value" :value="value" :disabled="['quote_pending','quoted'].includes(selectedOrder.shipping_status) && !selectedOrder.shipping_accepted_at && ['confirmed','paid','fulfilling','shipped','completed'].includes(value)">{{ statusLabel(value) }}</a-option></a-select></a-form-item><a-form-item label="物流单号"><a-input v-model="trackingNumber" /></a-form-item><a-form-item label="物流查询 HTTPS 链接"><a-input v-model="trackingUrl" placeholder="https://carrier.example/track/..." /></a-form-item></a-form>
      </template>
      <template #footer><a-space><a-button @click="orderOpen = false">关闭</a-button><a-button v-if="selectedOrder && ['paid','partially_refunded'].includes(selectedOrder.payment_status) && selectedOrder.payment_provider === 'stripe'" status="danger" @click="openRefund">退款</a-button><a-button type="primary" :loading="saving" @click="saveOrder">保存订单</a-button></a-space></template>
    </a-drawer>
    <a-modal v-model:visible="refundOpen" title="确认退款" :mask-closable="false" :ok-loading="refunding" ok-text="确认退款" @ok="submitRefund">
      <a-alert type="warning" show-icon class="refund-modal-tip">
        退款会调用 Stripe 原路退回，可全额或部分退款；部分退款后可继续退剩余金额。请输入本次退款金额，并用当前后台超级管理员账号和密码二次确认。
      </a-alert>
      <a-form layout="vertical">
        <a-form-item label="本次退款金额（美元）">
          <a-input-number v-model="refundAmount" :min="0" :max="refundRemainingCents / 100" :precision="2" style="width: 100%" />
          <template #extra>剩余可退：{{ money(refundRemainingCents, selectedOrder?.currency || 'USD') }}</template>
        </a-form-item>
        <a-form-item label="超级管理员邮箱">
          <a-input v-model="refundEmail" autocomplete="username" placeholder="管理员邮箱" />
        </a-form-item>
        <a-form-item label="超级管理员密码">
          <a-input-password v-model="refundPassword" autocomplete="current-password" placeholder="管理员密码" />
        </a-form-item>
        <a-form-item label="退款备注（可选）">
          <a-textarea v-model="refundReason" :auto-size="{ minRows: 2, maxRows: 4 }" placeholder="例如：客户申请退货，已确认" />
        </a-form-item>
        <a-typography-text type="secondary">本次将退款：{{ money(Math.round(Number(refundAmount || 0) * 100), selectedOrder?.currency || 'USD') }}</a-typography-text>
      </a-form>
    </a-modal>
    <a-drawer v-model:visible="customerOpen" :width="560" title="客户资料" unmount-on-close>
      <a-form v-if="selectedCustomer" layout="vertical"><a-form-item label="邮箱（不可更改）"><a-input :model-value="selectedCustomer.email" disabled /></a-form-item><a-form-item label="客户姓名"><a-input v-model="selectedCustomer.full_name" /></a-form-item><a-form-item label="联系电话"><a-input v-model="selectedCustomer.phone" /></a-form-item><a-form-item label="实名姓名"><a-input v-model="selectedCustomer.legal_name" /></a-form-item><a-form-item label="身份验证状态"><a-tag>{{ selectedCustomer.verification_status === 'verified' ? '已验证' : '未验证；当前未接入身份核验服务' }}</a-tag></a-form-item><a-descriptions :data="[{ label: '订单数', value: selectedCustomer.order_count }, { label: '已付款总额（按币种）', value: paidTotalsLabel(selectedCustomer.paid_totals) }]" :column="1" bordered /><a-divider>客户收货地址</a-divider><a-empty v-if="!selectedCustomer.addresses?.length" description="该客户尚未保存地址" /><a-list v-else :data="selectedCustomer.addresses"><template #item="{ item }"><a-list-item>{{ item.label || item.recipient }}{{ item.is_default ? '（默认）' : '' }} · {{ [item.line1,item.line2,item.city,item.region,item.postal_code,item.country].filter(Boolean).join(', ') }} · {{ item.phone }}</a-list-item></template></a-list></a-form>
      <template #footer><a-button @click="customerOpen = false">关闭</a-button><a-button type="primary" :loading="saving" @click="saveCustomer">保存客户资料</a-button></template>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Message } from '@arco-design/web-vue';
import MediaPicker from '@/components/content/MediaPicker.vue';
import MediaSequenceEditor from '@/components/content/MediaSequenceEditor.vue';
import { createProduct, getIntegrationStatus, getPolicies, getSettings, getStorefrontContent, listCustomers, listOrders, listProducts, refundOrder, updateCustomer, updateIntegrations, updateOrder, updatePolicies, updateProduct, updateSettings, updateStorefrontContent } from '@/api/commerce';
import type { ShopCustomer, ShopOrder, ShopProduct } from '@/api/commerce';

type CommerceSection = 'products' | 'orders' | 'customers' | 'settings' | 'integrations' | 'policies' | 'content';
const props = defineProps<{ section?: CommerceSection }>();
const SECTION_META: Record<CommerceSection, { title: string; subtitle: string; hint: string }> = {
  products: { title: '商品库存', subtitle: '商品、SKU、图片、规格、价格与库存', hint: '商品价格、详情、图片和视频在此维护；上架前请核对货币、库存与规格。' },
  orders: { title: '订单处理', subtitle: '待确认、运费报价、发货与完成的订单', hint: '运费报价需客户接受后才能进入付款；发货前请核对地址、数量与物流单号。' },
  customers: { title: '客户资料', subtitle: '客户账户、收货地址与实名信息', hint: '客户资料仅用于订单履约与售后；身份核验服务需要单独接入后才能标记已实名。' },
  settings: { title: '结算与运费', subtitle: '店铺货币、运费方式、下单开关与咨询邮箱', hint: '修改币种或运费方式前，请确认所有上架商品与进行中的订单不受影响。' },
  integrations: { title: '支付', subtitle: 'Stripe / PayPal 收款与 Webhook', hint: '生产环境必须使用 HTTPS、正式商户密钥和已登记的 Webhook；密钥只加密保存，不回显。' },
  policies: { title: '店铺政策', subtitle: '隐私、Cookie、销售条款、配送与退货政策', hint: '以下文本会直接展示给客户；上线前请由熟悉当地法律的顾问审核。' },
  content: { title: '页面内容', subtitle: '品牌、公告、首页、关于、方案、商城、联系、动态、导航、页脚与社交链接', hint: '保存后前台实时读取；图片和视频可从媒体素材库选择，也可粘贴 HTTPS 地址。' }
};
const section = computed<CommerceSection>(() => props.section || 'products');
const sectionMeta = computed(() => SECTION_META[section.value]);

const CONTENT_SECTIONS = [
  { key: 'brand', label: '品牌与公告' },
  { key: 'nav', label: '导航与页脚' },
  { key: 'home', label: '首页' },
  { key: 'solutions', label: '应用方案' },
  { key: 'pages', label: '关于 / 商品 / 联系 / 动态' }
] as const;
type ContentSection = typeof CONTENT_SECTIONS[number]['key'];
const contentSections = CONTENT_SECTIONS;
const contentSection = ref<ContentSection>('brand');
const route = useRoute();
const router = useRouter();

function isContentSection(value: unknown): value is ContentSection {
  return CONTENT_SECTIONS.some((item) => item.key === value);
}
function selectContentSection(key: ContentSection) {
  contentSection.value = key;
  if (section.value !== 'content') return;
  const query = { ...route.query, section: key };
  router.replace({ query });
}
watch(
  () => route.query.section,
  (value) => {
    if (typeof value === 'string' && isContentSection(value)) contentSection.value = value;
  },
  { immediate: true }
);

const emptyProduct = (): ShopProduct => ({ id: '', sku: '', slug: '', category: 'Attachments', name: '', summary: '', description: '', image_url: '', gallery: [], highlights: [], specifications: [], faqs: [], videos: [], currency: 'USD', price_cents: 0, stock: 0, allow_backorder: false, active: false, featured: false, sort_order: 0, shipping_rules: { mode: 'inherit', zones: [] } });
const products = ref<ShopProduct[]>([]);
const orders = ref<ShopOrder[]>([]);
const customers = ref<ShopCustomer[]>([]);
const settings = reactive({ shipping_mode: 'quote' as 'quote' | 'flat', shipping_cents: 0, shipping_zones: [] as Array<{ id: string; name: string; countriesText: string; mode: 'quote' | 'flat'; amount_cents: number; active: boolean }>, checkout_enabled: true, support_email: '', currency: 'USD' as 'USD' | 'CNY', payment_provider: 'manual' as 'manual' | 'stripe' | 'paypal', payment_configured: false });
const integrations = reactive({ google_configured: false, facebook_configured: false, stripe_configured: false, paypal_configured: false });
const paymentSecrets = reactive({ stripeSecret: '', stripeWebhookSecret: '', paypalClientId: '', paypalClientSecret: '', paypalWebhookId: '', paypalMode: 'sandbox' });
const policies = reactive({ privacy_policy: '', cookie_policy: '', terms_policy: '', shipping_policy: '', returns_policy: '' });
const storefrontContent = reactive<any>({
  brand: { name: '宏盟机械', tagline: 'HONGMENG MACHINERY', logo: '/assets/hongmeng-logo.svg' },
  announcement: { text: '专业机械附件 · 支持美国配送', cta: '即刻选购', ctaHref: '/shop/' },
  navigation: { homeLabel: '首页', aboutLabel: '关于我们', productsLabel: '选购附件', solutionsLabel: '应用方案', contactLabel: '联系我们' },
  home: { eyebrow: '', title: '', subtitle: '', heroImage: '', heroVideo: '', heroMedia: [], cta: '', ctaHref: '/shop/', introEyebrow: '', introTitle: '', introDescription: '', introImage: '', introMedia: [], introCta: '', introCtaHref: '/about/', featureEyebrow: '', featureTitle: '', featureDescription: '', featureImage: '', featureMedia: [], featureCta: '', featureCtaHref: '/shop/', featuredEyebrow: '', featuredTitle: '', featuredDescription: '', featuredLinkLabel: '', featuredHref: '/shop/', bottomEyebrow: '', bottomTitle: '', bottomDescription: '', bottomImage: '', bottomMedia: [], bottomCta: '', bottomCtaHref: '/contact/', benefits: [{ title: '', description: '' }, { title: '', description: '' }, { title: '', description: '' }, { title: '', description: '' }] },
  solutions: { eyebrow: '', title: '', description: '', image: '', heroMedia: [], items: [], itemOneTitle: '', itemOneDescription: '', itemOneImage: '', itemTwoTitle: '', itemTwoDescription: '', itemTwoImage: '', itemThreeTitle: '', itemThreeDescription: '', itemThreeImage: '', bottomTitle: '', bottomDescription: '', bottomCta: '' },
  about: { eyebrow: '', title: '', description: '', body: '', heroImage: '', image: '', video: '', heroMedia: [], contentMedia: [], ctaLabel: '', ctaHref: '/contact/', finalTitle: '', finalCta: '', finalCtaHref: '/shop/' },
  shop: { eyebrow: '', title: '', description: '', emptyMessage: '' },
  contact: { title: '', description: '', sideTitle: '', sideDescription: '', image: '', media: [] },
  news: { eyebrow: '', title: '', description: '', storyEyebrow: '', storyTitle: '', storyDescription: '', image: '', video: '', videoMedia: [], media: [], primaryCta: '', primaryHref: '/contact/', secondaryCta: '', secondaryHref: '/shop/' },
  cart: { emptyMedia: [] },
  footer: { description: '', quickLinksTitle: '', helpTitle: '', helpText: '', supportTitle: '', productsLabel: '', aboutLabel: '', newsLabel: '', contactLabel: '', accountLabel: '', cartLabel: '', privacyLabel: '', cookieLabel: '', termsLabel: '', shippingLabel: '', returnsLabel: '' },
  social: { tiktok: '', facebook: '', instagram: '', x: '', youtube: '', telegram: '', whatsapp: '' }
});
const editing = reactive<ShopProduct>(emptyProduct());
const selectedOrder = ref<ShopOrder | null>(null);
const selectedCustomer = ref<ShopCustomer | null>(null);
const productOpen = ref(false);
const orderOpen = ref(false);
const customerOpen = ref(false);
const loading = ref(false);
const saving = ref(false);
const productMediaItems = ref<Array<{ url: string; type: 'image' | 'video'; autoplay?: boolean; muted?: boolean; youtubeLink?: string }>>([]);
const highlightsText = ref('');
const specificationsText = ref('');
const faqsText = ref('');
const orderStatus = ref('pending');
const trackingNumber = ref('');
const trackingUrl = ref('');
const shippingQuoteAmount = ref<number | null>(null);
const refundOpen = ref(false);
const refunding = ref(false);
const refundEmail = ref('');
const refundPassword = ref('');
const refundReason = ref('');
const refundAmount = ref(0);
const statuses = ['pending', 'confirmed', 'paid', 'fulfilling', 'shipped', 'completed', 'cancelled'];
const productImageChoices = [
  { url: '/assets/generated/product-hm38.webp', label: '38 英寸鼓式附件' },
  { url: '/assets/generated/product-hm46.webp', label: '46 英寸鼓式附件' },
  { url: '/assets/generated/product-teeth.webp', label: '替换刀齿' },
  { url: '/assets/generated/product-belt.webp', label: '传动带' },
  { url: '/assets/generated/product-brackets.webp', label: '焊接刀座' },
  { url: '/assets/generated/product-mulcher-detail-v2.webp', label: '新增属具产品视图' },
  { url: '/assets/generated/solution-brush-clearing-v2.webp', label: '新增林地作业现场' },
  { url: '/assets/generated/solution-fence-line-v2.webp', label: '新增道路维护现场' },
  { url: '/assets/generated/manufacturing-assembly-v2.webp', label: '新增车间装配现场' },
  { url: '/assets/generated/solution-forestry.webp', label: '林地清理现场' },
  { url: '/assets/generated/solution-land-clearing.webp', label: '道路灌木清理' },
  { url: '/assets/generated/solution-woodland.webp', label: '林地设备作业' },
  { url: '/assets/generated/attachment-detail.webp', label: '属具齿辊细节' },
  { url: '/assets/generated/attachment-inspection.webp', label: '属具检验细节' },
];
const statusLabel = (value: string) => ({ pending: '待确认', confirmed: '已确认', paid: '已付款', fulfilling: '备货中', shipped: '已发货', completed: '已完成', cancelled: '已取消' }[value] || value);
const money = (cents: number, currency = 'USD') => new Intl.NumberFormat(currency === 'CNY' ? 'zh-CN' : 'en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100);
const paidTotalsLabel = (totals?: Record<string, number | string>) => Object.entries(totals || {}).map(([currency, cents]) => money(Number(cents), currency)).join(' / ') || '—';
const date = (value: string) => new Date(value).toLocaleString('zh-CN');
const oauthRedirect = (provider: 'google' | 'facebook') => `${window.location.origin}/site-admin-api/customer/oauth/${provider}/callback`;
const priceAmount = computed({ get: () => editing.price_cents / 100, set: (value: number) => { editing.price_cents = Math.round(Number(value || 0) * 100); } });
const shippingAmount = computed({ get: () => settings.shipping_cents / 100, set: (value: number) => { settings.shipping_cents = Math.round(Number(value || 0) * 100); } });
const refundRemainingCents = computed(() => selectedOrder.value ? Math.max(0, Number(selectedOrder.value.total_cents || 0) - Number(selectedOrder.value.refunded_cents || 0)) : 0);
const shippingQuoteCents = computed(() => Math.round(Number(shippingQuoteAmount.value ?? 0) * 100));

async function refresh() {
  loading.value = true;
  try {
    const [p, o, s, i, legal, storefront, c] = await Promise.all([listProducts(), listOrders(), getSettings(), getIntegrationStatus(), getPolicies(), getStorefrontContent(), listCustomers()]);
    products.value = p; orders.value = o; customers.value = c; Object.assign(settings, s); settings.shipping_zones = (s.shipping_zones || []).map((zone: any, index: number) => ({ id: String(zone.id || `zone_${index + 1}`), name: String(zone.name || `地区 ${index + 1}`), countriesText: Array.isArray(zone.countries) ? zone.countries.join(', ') : '', mode: zone.mode === 'quote' ? 'quote' : 'flat', amount_cents: Number(zone.amount_cents || 0), active: zone.active !== false }));
    Object.assign(integrations, i); Object.assign(policies, legal);
    for (const key of Object.keys(storefrontContent) as Array<keyof typeof storefrontContent>) Object.assign(storefrontContent[key], storefront?.[key] || {});
    const legacyMediaSlots: Array<[string, string, string[]]> = [
      ['home', 'heroMedia', [...[storefrontContent.home.heroVideo, storefrontContent.home.heroImage].filter(Boolean), '/assets/generated/home-hero.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp']],
      ['home', 'introMedia', [storefrontContent.home.introImage || '/assets/generated/home-intro.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp', '/assets/generated/attachment-inspection.webp']],
      ['home', 'featureMedia', [storefrontContent.home.featureImage || '/assets/generated/home-feature.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-fence-line-v2.webp', '/assets/generated/solution-woodland.webp']],
      ['home', 'bottomMedia', [storefrontContent.home.bottomImage || '/assets/generated/home-feature.webp', '/assets/generated/solution-forestry.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-land-clearing.webp']],
      ['about', 'heroMedia', [storefrontContent.about.heroImage || '/assets/generated/about-hero.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp']],
      ['solutions', 'heroMedia', [storefrontContent.solutions.image || '/assets/generated/solution-forestry.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-woodland.webp']],
      ['about', 'contentMedia', [storefrontContent.about.image || '/assets/generated/about-detail.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp', '/assets/generated/attachment-inspection.webp', storefrontContent.about.video].filter(Boolean)],
      ['contact', 'media', [storefrontContent.contact.image || '/assets/generated/contact-support.webp', '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp', '/assets/generated/attachment-inspection.webp']],
      ['news', 'media', [storefrontContent.news.image || '/assets/generated/news-field.webp', '/assets/generated/solution-land-clearing.webp', '/assets/generated/solution-fence-line-v2.webp', '/assets/generated/solution-woodland.webp']],
      ['news', 'videoMedia', storefrontContent.news.video ? [storefrontContent.news.video] : []]
    ];
    for (const [section, field, urls] of legacyMediaSlots) {
      if (!Array.isArray(storefront?.[section]?.[field])) {
        storefrontContent[section][field] = urls.map((url) => ({ url, type: /\.(mp4|webm|mov|m3u8|ogg)(?:$|[?#])/i.test(url) || /youtube\.com|youtu\.be/i.test(url) ? 'video' : 'image', autoplay: false, muted: true }));
      }
    }
    if (!Array.isArray(storefront?.cart?.emptyMedia)) {
      storefrontContent.cart.emptyMedia = [{ url: '/assets/generated/cart-empty.webp', type: 'image' }, { url: '/assets/generated/product-hm38.webp', type: 'image' }, { url: '/assets/generated/product-teeth.webp', type: 'image' }];
    }
    if (!Array.isArray(storefront?.news?.videoMedia)) {
      storefrontContent.news.videoMedia = storefrontContent.news.video ? [{ url: storefrontContent.news.video, type: 'video', autoplay: false, muted: true }] : [];
    }
    if (!Array.isArray(storefront?.solutions?.items)) {
      const legacy = [
        { title: storefrontContent.solutions.itemOneTitle, description: storefrontContent.solutions.itemOneDescription, media: [storefrontContent.solutions.itemOneImage, '/assets/generated/solution-forestry.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp'].filter(Boolean).map((url) => ({ url, type: 'image' })) },
        { title: storefrontContent.solutions.itemTwoTitle, description: storefrontContent.solutions.itemTwoDescription, media: [storefrontContent.solutions.itemTwoImage, '/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp', '/assets/generated/attachment-inspection.webp'].filter(Boolean).map((url) => ({ url, type: 'image' })) },
        { title: storefrontContent.solutions.itemThreeTitle, description: storefrontContent.solutions.itemThreeDescription, media: [storefrontContent.solutions.itemThreeImage, '/assets/generated/product-teeth.webp', '/assets/generated/attachment-detail.webp', '/assets/generated/product-mulcher-detail-v2.webp'].filter(Boolean).map((url) => ({ url, type: 'image' })) }
      ].filter((item) => item.title || item.description || item.media.length);
      storefrontContent.solutions.items = legacy.length ? legacy : [
        { title: '场地与植被维护', description: '针对植被、地形和作业频率，选择合适的属具。', media: ['/assets/generated/solution-forestry.webp', '/assets/generated/solution-brush-clearing-v2.webp', '/assets/generated/solution-fence-line-v2.webp'].map((url) => ({ url, type: 'image' })) },
        { title: '设备属具选型', description: '提供设备型号和安装接口，核对安装与操作要求。', media: ['/assets/generated/manufacturing-workshop.webp', '/assets/generated/manufacturing-assembly-v2.webp', '/assets/generated/attachment-inspection.webp'].map((url) => ({ url, type: 'image' })) },
        { title: '配件更换与维护', description: '根据零件编号、尺寸或照片确认替换配件。', media: ['/assets/generated/attachment-detail.webp', '/assets/generated/attachment-inspection.webp', '/assets/generated/product-mulcher-detail-v2.webp'].map((url) => ({ url, type: 'image' })) }
      ];
    }
  } catch (error: any) { Message.error(error?.response?.data?.error?.message || '商城数据加载失败'); }
  finally { loading.value = false; }
}
function newProduct() { Object.assign(editing, emptyProduct()); productMediaItems.value = []; highlightsText.value = ''; specificationsText.value = ''; faqsText.value = ''; productOpen.value = true; }
function editProduct(product: ShopProduct) { Object.assign(editing, JSON.parse(JSON.stringify(product))); if (!editing.shipping_rules) editing.shipping_rules = { mode: 'inherit', zones: [] }; editing.shipping_rules.zones = (editing.shipping_rules.zones || []).map((zone: any) => ({ ...zone, countriesText: Array.isArray(zone.countries) ? zone.countries.join(', ') : '' })); productMediaItems.value = [...(product.gallery || []).map((url) => ({ url, type: 'image' as const })), ...(product.videos || []).map((entry) => typeof entry === 'string' ? ({ url: entry, type: 'video' as const, autoplay: false, muted: true }) : ({ url: entry.url, type: 'video' as const, autoplay: entry.autoplay === true, muted: entry.muted !== false, youtubeLink: entry.youtubeLink }))]; highlightsText.value = product.highlights.join('\n'); specificationsText.value = product.specifications.map((item) => `${item.label} | ${item.value}`).join('\n'); faqsText.value = (product.faqs || []).map((item) => `${item.question} | ${item.answer}`).join('\n'); productOpen.value = true; }
function addProductShippingZone() {
  editing.shipping_rules.zones.push({ id: `product_zone_${Date.now()}`, name: '', countries: [], countriesText: '', mode: 'flat', amount_cents: 0, active: true } as any);
}
function removeProductShippingZone(index: number) {
  editing.shipping_rules.zones.splice(index, 1);
}
function productPayload(): ShopProduct {
  return {
    ...editing,
    shipping_rules: {
      mode: editing.shipping_rules?.mode || 'inherit',
      zones: (editing.shipping_rules?.zones || []).map((zone: any) => ({
        id: zone.id, name: zone.name,
        countries: String(zone.countriesText || '').split(/[,\s]+/).filter(Boolean),
        mode: zone.mode, amount_cents: Number(zone.amount_cents || 0), active: zone.active !== false
      }))
    }
  };
}
async function saveProduct() {
  saving.value = true;
  try {
    editing.gallery = productMediaItems.value.filter((item) => item.type === 'image').map((item) => item.url.trim()).filter(Boolean).slice(0, 12);
    editing.highlights = highlightsText.value.split('\n').map((value) => value.trim()).filter(Boolean);
    editing.specifications = specificationsText.value.split('\n').map((line) => { const [label, ...rest] = line.split('|'); return { label: label.trim(), value: rest.join('|').trim() }; }).filter((item) => item.label && item.value);
    editing.faqs = faqsText.value.split('\n').map((line) => { const [question, ...rest] = line.split('|'); return { question: question.trim(), answer: rest.join('|').trim() }; }).filter((item) => item.question && item.answer);
    editing.videos = productMediaItems.value.filter((item) => item.type === 'video').map((item) => ({ ...item, url: item.url.trim() })).filter((item) => item.url).slice(0, 8);
    const payload = productPayload(); if (editing.id) await updateProduct(payload); else await createProduct(payload);
    Message.success('商品已保存'); productOpen.value = false; await refresh();
  } catch (error: any) { Message.error(error?.response?.data?.error?.message || '保存失败'); }
  finally { saving.value = false; }
}
function editOrder(order: ShopOrder) { selectedOrder.value = order; orderStatus.value = order.status; trackingNumber.value = order.tracking_number || ''; trackingUrl.value = order.tracking_url || ''; shippingQuoteAmount.value = order.shipping_status === 'quote_pending' ? null : order.shipping_cents / 100; orderOpen.value = true; }
function editCustomer(customer: ShopCustomer) { selectedCustomer.value = JSON.parse(JSON.stringify(customer)); customerOpen.value = true; }
function openRefund() {
  if (!selectedOrder.value) return;
  refundEmail.value = '';
  refundPassword.value = '';
  refundReason.value = selectedOrder.value.refund_request?.reason || '';
  refundAmount.value = refundRemainingCents.value / 100;
  refundOpen.value = true;
}
async function submitRefund() {
  if (!selectedOrder.value) return;
  if (!refundEmail.value.trim() || !refundPassword.value) {
    Message.warning('请输入超级管理员邮箱和密码');
    return false;
  }
  const amountCents = Math.round(Number(refundAmount.value || 0) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > refundRemainingCents.value) {
    Message.warning('退款金额必须大于 0 且不超过剩余可退金额');
    return false;
  }
  refunding.value = true;
  try {
    await refundOrder(selectedOrder.value.id, {
      email: refundEmail.value.trim(),
      password: refundPassword.value,
      reason: refundReason.value.trim(),
      amount_cents: amountCents
    });
    Message.success(amountCents >= refundRemainingCents.value ? '退款已提交 Stripe，订单已全额退款' : '部分退款已提交 Stripe');
    refundOpen.value = false;
    refundPassword.value = '';
    orderOpen.value = false;
    await refresh();
    return true;
  } catch (error: any) {
    Message.error(error?.response?.data?.error?.message || '退款失败');
    return false;
  } finally {
    refunding.value = false;
  }
}
async function saveCustomer() {
  if (!selectedCustomer.value) return;
  saving.value = true;
  try { await updateCustomer(selectedCustomer.value); Message.success('客户资料已保存'); customerOpen.value = false; await refresh(); }
  catch (error: any) { Message.error(error?.response?.data?.error?.message || '客户资料保存失败'); }
  finally { saving.value = false; }
}
async function saveOrder() {
  if (!selectedOrder.value) return;
  saving.value = true;
  try { await updateOrder(selectedOrder.value.id, { status: orderStatus.value, tracking_number: trackingNumber.value, tracking_url: trackingUrl.value, ...(selectedOrder.value.shipping_status === 'quote_pending' && shippingQuoteAmount.value !== null ? { shipping_cents: shippingQuoteCents.value } : {}) }); Message.success('订单已更新'); orderOpen.value = false; await refresh(); }
  catch (error: any) { Message.error(error?.response?.data?.error?.message || '更新失败'); }
  finally { saving.value = false; }
}
function addShippingZone() {
  settings.shipping_zones.push({ id: `zone_${Date.now()}`, name: '', countriesText: '', mode: 'flat', amount_cents: 0, active: true });
}
function removeShippingZone(index: number) {
  settings.shipping_zones.splice(index, 1);
}

async function saveSettings() {
  saving.value = true;
  try { await updateSettings({ ...settings, shipping_zones: settings.shipping_zones.map((zone) => ({ id: zone.id, name: zone.name, countries: zone.countriesText.split(/[,\s]+/).filter(Boolean), mode: zone.mode, amount_cents: zone.amount_cents, active: zone.active })) }); Message.success('设置已保存'); await refresh(); }
  catch (error: any) { Message.error(error?.response?.data?.error?.message || '保存失败'); }
  finally { saving.value = false; }
}
async function saveIntegrations() {
  saving.value = true;
  try {
    await updateIntegrations({ payment_secrets: { ...paymentSecrets } });
    Object.assign(paymentSecrets, { stripeSecret: '', stripeWebhookSecret: '', paypalClientId: '', paypalClientSecret: '', paypalWebhookId: '' });
    Message.success('接入凭据已加密保存'); await refresh();
  } catch (error: any) { Message.error(error?.response?.data?.error?.message || '凭据保存失败'); }
  finally { saving.value = false; }
}
async function savePolicies() {
  saving.value = true;
  try { Object.assign(policies, await updatePolicies(policies)); Message.success('政策内容已保存'); }
  catch (error: any) { Message.error(error?.response?.data?.error?.message || '政策保存失败'); }
  finally { saving.value = false; }
}

function addSolution() { storefrontContent.solutions.items.push({ title: '', eyebrow: '', description: '', media: [], linkLabel: '咨询应用方案', linkHref: '/contact/' }); }
function removeSolution(index: number) { storefrontContent.solutions.items.splice(index, 1); }
function moveSolution(index: number, direction: number) {
  const target = index + direction;
  if (target < 0 || target >= storefrontContent.solutions.items.length) return;
  const [item] = storefrontContent.solutions.items.splice(index, 1);
  storefrontContent.solutions.items.splice(target, 0, item);
}
async function saveStorefrontContent() {
  const social = (storefrontContent.social || {}) as Record<string, string>;
  for (const key of Object.keys(social)) social[key] = String(social[key] || '').trim();
  const invalidSocial = Object.values(social).filter((value) => value && !/^https?:\/\//i.test(value));
  if (invalidSocial.length) { Message.warning('社交媒体链接必须以 http:// 或 https:// 开头'); return; }
  saving.value = true;
  try { const payload = structuredClone(toRaw(storefrontContent)); Object.assign(payload.home, { heroImage: '', heroVideo: '', introImage: '', featureImage: '', bottomImage: '' }); Object.assign(payload.about, { heroImage: '', image: '', video: '' }); Object.assign(payload.solutions, { image: '' }); Object.assign(payload.contact, { image: '' }); Object.assign(payload.news, { image: '', video: '' }); for (const key of ['itemOneTitle','itemOneDescription','itemOneImage','itemTwoTitle','itemTwoDescription','itemTwoImage','itemThreeTitle','itemThreeDescription','itemThreeImage']) delete payload.solutions[key]; const saved = await updateStorefrontContent(payload); for (const key of Object.keys(storefrontContent) as Array<keyof typeof storefrontContent>) Object.assign(storefrontContent[key], saved?.[key] || {}); Message.success('页面内容已保存'); }
  catch (error: any) { Message.error(error?.response?.data?.error?.message || '页面内容保存失败'); }
  finally { saving.value = false; }
}
onMounted(refresh);
</script>

<style scoped>
.commerce-manage { padding: 0; }
.section-page { display: block; }
.section-shell { min-height: 320px; }
.content-editor { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 18px; align-items: start; }
.content-editor-nav { position: sticky; top: 84px; display: flex; flex-direction: column; gap: 4px; padding: 14px; border: 1px solid var(--color-border-2); border-radius: 8px; background: var(--color-bg-2); }
.content-editor-nav strong { margin-bottom: 6px; color: var(--color-text-2); font-size: 12px; letter-spacing: .08em; }
.content-editor-nav button { border: 0; border-radius: 6px; padding: 9px 10px; background: transparent; color: var(--color-text-1); text-align: left; cursor: pointer; font-size: 13px; }
.content-editor-nav button:hover { background: var(--color-fill-2); }
.content-editor-nav button.active { background: rgb(var(--primary-1)); color: rgb(var(--primary-6)); font-weight: 600; }
.content-editor-panel { min-width: 0; }
.content-editor-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
@media (max-width: 900px) { .content-editor { grid-template-columns: 1fr; } .content-editor-nav { position: static; flex-direction: row; flex-wrap: wrap; } }
.mb-4 { margin-bottom: 16px; }
.mt-4 { margin-top: 16px; }
.thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; }
.solution-editor-card { border: 1px solid var(--color-border-2); border-radius: 8px; padding: 16px; margin: 12px 0; background: var(--color-bg-2); }
.solution-editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
@media (max-width: 600px) { .solution-editor-heading { align-items: flex-start; flex-direction: column; } }
.image-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.image-choice { min-width: 0; padding: 5px; border: 1px solid var(--color-border-2); background: var(--color-bg-2); text-align: left; cursor: pointer; }
.image-choice.selected { border-color: rgb(var(--primary-6)); box-shadow: 0 0 0 1px rgb(var(--primary-6)); }
.image-choice img { display: block; width: 100%; height: 92px; object-fit: cover; }
.image-choice span { display: block; padding: 6px 3px 2px; color: var(--color-text-1); font-size: 12px; }
.image-preview { display: block; max-width: 200px; max-height: 130px; object-fit: cover; margin-top: 10px; border-radius: 4px; }
.settings-card { max-width: 580px; }
.settlement-card { margin-bottom: 16px; }
.product-shipping-zone { padding: 8px 0; border-bottom: 1px dashed var(--color-border-2); }
.shipping-zone-row { padding: 10px 0; border-bottom: 1px dashed var(--color-border-2); }
.shipping-zone-row:last-of-type { border-bottom: 0; }
.refund-alert { margin-bottom: 16px; }
.refund-modal-tip { margin-bottom: 16px; }
.settlement-status { height: 100%; }
.status-link { margin-top: 16px; }
.section-save-bar { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 14px 0 2px; background: var(--color-fill-2); }
.integration-card, .policy-card { max-width: 900px; margin-bottom: 16px; }
.integration-help { margin: 12px 0 0; color: var(--color-text-3); line-height: 1.6; }
</style>
