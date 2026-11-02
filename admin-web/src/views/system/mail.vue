<template>
  <a-card :bordered="false" class="mail-page">
    <template #title>邮件发送</template>
    <template #extra>
      <a-space>
        <a-button :loading="loading" @click="reload">刷新</a-button>
        <a-button
          type="primary"
          :loading="saving"
          data-testid="mail-save"
          @click="save"
        >
          保存
        </a-button>
      </a-space>
    </template>

    <a-alert class="tips" type="info">
      商城注册、下单等验证码邮件都通过此 SMTP 发送。未配置时验证码邮件会发送失败。密码只加密保存在服务端，页面只回显掩码：<strong data-testid="mail-masked">{{ passwordState }}</strong>。留空表示不修改密码，勾选「清除密码」并保存可删除已保存的密码。
    </a-alert>

    <a-alert class="banner" :type="configured ? 'success' : 'warning'" show-icon>
      当前状态：<strong data-testid="mail-status">{{ configuredState }}</strong>
      <template v-if="configured">
        ，最近更新：{{ localTime(settings.updated_at) }}。
      </template>
      <template v-else>
        ，请填写服务器、端口、账号与发件人后保存，并发送测试邮件确认可用。
      </template>
    </a-alert>

    <a-alert v-if="loadError" class="banner" type="error" show-icon>
      {{ loadError }}
      <template #action>
        <a-button size="mini" @click="reload">重试</a-button>
      </template>
    </a-alert>

    <a-alert v-if="saveError" class="banner" type="error" show-icon>
      {{ saveError }}
    </a-alert>

    <a-spin :loading="loading" style="width: 100%">
      <a-form :model="form" layout="vertical" class="smtp-form">
        <a-form-item label="SMTP 服务器">
          <a-input
            v-model="form.host"
            placeholder="例如：smtp.example.com"
            :input-attrs="{ 'data-testid': 'mail-host' }"
          />
          <template #extra>
            用于发送验证码邮件的 SMTP 服务地址；Gmail 可填 smtp.gmail.com。
          </template>
        </a-form-item>
        <a-form-item label="端口">
          <a-input-number
            v-model="form.port"
            :min="1"
            :max="65535"
            :precision="0"
            :input-attrs="{ 'data-testid': 'mail-port' }"
            style="width: 180px"
          />
          <template #extra>
            常用 587（STARTTLS）或 465（SSL）。
          </template>
        </a-form-item>
        <a-form-item label="启用 SSL / TLS">
          <a-switch
            v-model="form.secure"
            data-testid="mail-secure"
          />
          <template #extra>
            587 端口一般用 STARTTLS，465 端口用 SSL，按服务商说明选择。
          </template>
        </a-form-item>
        <a-form-item label="用户名">
          <a-input
            v-model="form.user"
            placeholder="通常为完整邮箱地址"
            :input-attrs="{ 'data-testid': 'mail-user' }"
          />
        </a-form-item>
        <a-form-item label="密码 / 授权码">
          <a-input-password
            v-model="form.password"
            placeholder="留空不修改"
            :input-attrs="{ 'data-testid': 'mail-password' }"
          />
          <template #extra>
            留空不修改；要删除已保存的密码请勾选下面的「清除已保存的密码」。
          </template>
        </a-form-item>
        <a-form-item label="发件人名称">
          <a-input
            v-model="form.from_name"
            placeholder="例如：鸿蒙机械"
            :input-attrs="{ 'data-testid': 'mail-from-name' }"
          />
          <template #extra>
            显示在收件人邮箱的发件人一栏。
          </template>
        </a-form-item>
        <a-form-item label="发件人地址">
          <a-input
            v-model="form.from_email"
            placeholder="例如：no-reply@example.com"
            :input-attrs="{ 'data-testid': 'mail-from-email' }"
          />
        </a-form-item>
        <a-form-item>
          <a-checkbox
            v-model="form.clearPassword"
            data-testid="mail-clear"
          >
            清除已保存的密码
          </a-checkbox>
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              :loading="saving"
              data-testid="mail-save-bottom"
              @click="save"
            >
              保存
            </a-button>
            <a-typography-text type="secondary">
              保存后新配置立即用于验证码邮件，无需重启。
            </a-typography-text>
          </a-space>
        </a-form-item>
      </a-form>

      <a-divider />

      <div class="test-block">
        <a-typography-title :heading="6" class="test-title">发送测试邮件</a-typography-title>
        <a-typography-text type="secondary" class="test-hint">
          先用当前已保存的配置发送一封测试邮件，确认可送达后再依赖它发送验证码。
        </a-typography-text>
        <a-space class="test-form">
          <a-input
            v-model="testTo"
            placeholder="收件人邮箱"
            style="width: 280px"
            :input-attrs="{ 'data-testid': 'mail-test-to' }"
          />
          <a-button
            type="outline"
            :loading="testing"
            data-testid="mail-test-send"
            @click="sendTest"
          >
            发送测试邮件
          </a-button>
        </a-space>
        <a-alert v-if="testResult" class="banner" type="success" show-icon>
          {{ testResult }}
        </a-alert>
        <a-alert v-if="testError" class="banner" type="error" show-icon>
          {{ testError }}
        </a-alert>
      </div>

      <a-divider />

      <div class="log-block">
        <a-space class="log-head">
          <a-typography-title :heading="6" class="test-title">最近发送记录</a-typography-title>
          <a-button size="mini" :loading="logLoading" data-testid="mail-log-refresh" @click="loadLog">
            刷新记录
          </a-button>
        </a-space>
        <a-alert v-if="logError" class="banner" type="error" show-icon>
          {{ logError }}
        </a-alert>
        <a-list :data="logRows" :loading="logLoading" bordered size="small">
          <template #item="{ item }">
            <a-list-item data-testid="mail-log-row">
              <div class="log-item">
                <a-space class="log-meta">
                  <a-typography-text type="secondary">
                    {{ localTime(item.created_at) }}
                  </a-typography-text>
                  <a-typography-text>{{ item.to || '-' }}</a-typography-text>
                  <a-tag size="small">{{ item.purpose || '-' }}</a-tag>
                  <a-tag :color="item.status === 'failed' ? 'red' : 'green'" size="small">
                    {{ item.status === 'failed' ? '失败' : '已发送' }}
                  </a-tag>
                </a-space>
                <a-typography-text
                  v-if="item.detail"
                  type="secondary"
                  class="log-detail"
                >
                  {{ item.detail }}
                </a-typography-text>
              </div>
            </a-list-item>
          </template>
          <template #empty>
            <a-empty description="暂无发送记录" />
          </template>
        </a-list>
      </div>
    </a-spin>
  </a-card>
</template>

<script lang="ts" setup>
  import { computed, onMounted, reactive, ref } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import dayjs from 'dayjs';
  import {
    fetchMailLog,
    fetchMailSettings,
    saveMailSettings,
    sendTestMail,
  } from '@/api/admin';
  import type { MailSettingsPayload } from '@/api/admin';

  const settings = ref<any>({});
  const loading = ref(false);
  const saving = ref(false);
  const logLoading = ref(false);
  const testing = ref(false);
  const loadError = ref('');
  const saveError = ref('');
  const logError = ref('');
  const testError = ref('');
  const testResult = ref('');
  const testTo = ref('');
  const logRows = ref<any[]>([]);
  const form = reactive({
    host: '',
    port: 587,
    secure: true,
    user: '',
    password: '',
    from_name: '',
    from_email: '',
    clearPassword: false,
  });

  const configured = computed(() => settings.value?.configured === true);
  const configuredState = computed(() => (configured.value ? '已配置' : '未配置'));
  const passwordState = computed(() => {
    const masked = String(settings.value?.password_masked ?? '').trim();
    return masked ? `已配置（${masked}）` : '未配置';
  });

  function backendMessage(reason: any, fallback: string) {
    return (
      reason?.response?.data?.error?.message ||
      reason?.response?.data?.message ||
      reason?.message ||
      fallback
    );
  }

  function localTime(value: string) {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';
  }

  function applySettings(value: any) {
    const source = value && typeof value === 'object' ? value : {};
    settings.value = source;
    form.host = source.host ? String(source.host) : '';
    const port = Number(source.port);
    form.port = Number.isFinite(port) && port > 0 ? Math.trunc(port) : 587;
    form.secure = source.secure === true;
    form.user = source.user ? String(source.user) : '';
    form.from_name = source.from_name ? String(source.from_name) : '';
    form.from_email = source.from_email ? String(source.from_email) : '';
    // 密码永不回显：每次加载都清空输入框与清除标记。
    form.password = '';
    form.clearPassword = false;
    if (!String(testTo.value).trim()) {
      testTo.value = form.from_email;
    }
  }

  // password 不传=不改；传 ""=清除，同时置 clear_password。
  function buildPayload(): MailSettingsPayload {
    const payload: MailSettingsPayload = {
      host: String(form.host ?? '').trim(),
      port: Number(form.port) || 587,
      secure: Boolean(form.secure),
      user: String(form.user ?? '').trim(),
      from_email: String(form.from_email ?? '').trim(),
      from_name: String(form.from_name ?? '').trim(),
    };
    if (form.clearPassword) {
      payload.password = '';
      payload.clear_password = true;
    } else if (String(form.password ?? '').length) {
      payload.password = String(form.password);
    }
    return payload;
  }

  async function load() {
    loading.value = true;
    loadError.value = '';
    try {
      const result = await fetchMailSettings();
      applySettings(result);
    } catch (reason: any) {
      loadError.value = backendMessage(reason, '邮件设置加载失败，请稍后重试。');
    } finally {
      loading.value = false;
    }
  }

  async function loadLog() {
    logLoading.value = true;
    logError.value = '';
    try {
      const result = await fetchMailLog(10);
      logRows.value = Array.isArray(result) ? result.slice(0, 10) : [];
    } catch (reason: any) {
      logError.value = backendMessage(reason, '发送记录加载失败，请稍后重试。');
      logRows.value = [];
    } finally {
      logLoading.value = false;
    }
  }

  function reload() {
    load();
    loadLog();
  }

  async function save() {
    if (!String(form.host ?? '').trim()) {
      Message.warning('请填写 SMTP 服务器');
      return;
    }
    if (!String(form.from_email ?? '').trim()) {
      Message.warning('请填写发件人地址');
      return;
    }
    saving.value = true;
    saveError.value = '';
    try {
      const result = await saveMailSettings(buildPayload());
      if (result && typeof result === 'object') {
        applySettings(result);
      } else {
        form.password = '';
        form.clearPassword = false;
      }
      Message.success('邮件设置已保存');
    } catch (reason: any) {
      saveError.value = backendMessage(reason, '邮件设置保存失败，请稍后重试。');
    } finally {
      saving.value = false;
    }
  }

  async function sendTest() {
    const to = String(testTo.value ?? '').trim();
    if (!to) {
      Message.warning('请填写测试收件人邮箱');
      return;
    }
    testing.value = true;
    testError.value = '';
    testResult.value = '';
    try {
      const result = await sendTestMail({ to });
      testResult.value = result?.message || `测试邮件已发送至 ${to}`;
      Message.success('测试邮件已发送');
      await loadLog();
    } catch (reason: any) {
      testError.value = backendMessage(reason, '测试邮件发送失败，请检查配置后重试。');
    } finally {
      testing.value = false;
    }
  }

  onMounted(reload);
</script>

<style scoped lang="less">
  .tips {
    margin-bottom: 14px;
  }
  .banner {
    margin-bottom: 14px;
  }
  .smtp-form {
    max-width: 640px;
  }
  .test-block {
    max-width: 640px;
  }
  .test-title {
    margin: 0;
  }
  .test-hint {
    display: block;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .test-form {
    margin-bottom: 12px;
  }
  .log-head {
    margin-bottom: 10px;
  }
  .log-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .log-meta {
    flex-wrap: wrap;
  }
  .log-detail {
    word-break: break-all;
    font-size: 12px;
  }
</style>
