<template>
  <a-card :bordered="false" title="登录方式">
    <a-alert type="info" class="tip">
      Google / Facebook 登录属于系统级登录方式，不属于商城支付。密钥加密保存，页面只显示“已配置 / 待配置”。
    </a-alert>
    <a-row :gutter="16">
      <a-col :xs="24" :lg="12">
        <a-card :bordered="false" class="provider-card">
          <template #title>
            <a-space>
              <span>Google 登录</span>
              <a-tag :color="integrations.google_configured ? 'green' : 'gray'">
                {{ integrations.google_configured ? '已配置' : '待配置' }}
              </a-tag>
            </a-space>
          </template>
          <a-form layout="vertical">
            <a-form-item label="OAuth 回调地址">
              <a-input :model-value="callback('google')" readonly />
            </a-form-item>
            <a-form-item label="Google Client ID">
              <a-input-password v-model="oauthSecrets.googleClientId" placeholder="留空保留现有值" />
            </a-form-item>
            <a-form-item label="Google Client Secret">
              <a-input-password v-model="oauthSecrets.googleClientSecret" placeholder="留空保留现有值" />
            </a-form-item>
          </a-form>
        </a-card>
      </a-col>
      <a-col :xs="24" :lg="12">
        <a-card :bordered="false" class="provider-card">
          <template #title>
            <a-space>
              <span>Facebook 登录</span>
              <a-tag :color="integrations.facebook_configured ? 'green' : 'gray'">
                {{ integrations.facebook_configured ? '已配置' : '待配置' }}
              </a-tag>
            </a-space>
          </template>
          <a-form layout="vertical">
            <a-form-item label="OAuth 回调地址">
              <a-input :model-value="callback('facebook')" readonly />
            </a-form-item>
            <a-form-item label="Facebook App ID">
              <a-input-password v-model="oauthSecrets.facebookClientId" placeholder="留空保留现有值" />
            </a-form-item>
            <a-form-item label="Facebook App Secret">
              <a-input-password v-model="oauthSecrets.facebookClientSecret" placeholder="留空保留现有值" />
            </a-form-item>
          </a-form>
        </a-card>
      </a-col>
    </a-row>
    <a-button type="primary" :loading="saving" @click="save">保存登录方式</a-button>
  </a-card>
</template>

<script lang="ts" setup>
  import { onMounted, reactive, ref } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import { getIntegrationStatus, updateIntegrations } from '@/api/commerce';

  const integrations = reactive({ google_configured: false, facebook_configured: false });
  const oauthSecrets = reactive({
    googleClientId: '',
    googleClientSecret: '',
    facebookClientId: '',
    facebookClientSecret: '',
  });
  const saving = ref(false);

  function callback(provider: 'google' | 'facebook') {
    return `${window.location.origin}/site-admin-api/customer/oauth/${provider}/callback`;
  }

  async function load() {
    try {
      Object.assign(integrations, await getIntegrationStatus());
    } catch {
      /* 全局拦截器提示 */
    }
  }

  async function save() {
    saving.value = true;
    try {
      await updateIntegrations({ oauth_secrets: { ...oauthSecrets } });
      oauthSecrets.googleClientId = '';
      oauthSecrets.googleClientSecret = '';
      oauthSecrets.facebookClientId = '';
      oauthSecrets.facebookClientSecret = '';
      Message.success('登录方式已保存');
      await load();
    } finally {
      saving.value = false;
    }
  }

  onMounted(load);
</script>

<style scoped>
  .tip {
    margin-bottom: 16px;
  }
  .provider-card {
    height: 100%;
    margin-bottom: 16px;
  }
</style>
