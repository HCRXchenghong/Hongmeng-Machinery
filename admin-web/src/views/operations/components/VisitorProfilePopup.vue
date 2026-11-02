<template>
  <a-modal
    :visible="visible"
    title="访客画像"
    :width="680"
    :footer="false"
    :mask-closable="true"
    unmount-on-close
    data-testid="visitor-profile-popup"
    @cancel="close"
  >
    <a-spin :loading="loading" style="width: 100%">
      <div class="popup-head">
        <div class="popup-id">
          <a-typography-text type="secondary">访客 ID</a-typography-text>
          <strong class="mono" :title="visitorId">{{ visitorId || '（无）' }}</strong>
        </div>
        <a-space v-if="conversation">
          <a-tag size="small" :color="statusColor(conversation.status)">
            {{ statusLabel(conversation.status) }}
          </a-tag>
          <a-button
            v-if="visitorId"
            size="mini"
            :loading="loading"
            data-testid="profile-popup-reload"
            @click="load"
          >
            重新加载
          </a-button>
        </a-space>
      </div>

      <!-- 取不到画像时明确提示，而不是给一片空白。 -->
      <div v-if="state === 'empty'" class="popup-empty" data-testid="profile-popup-empty">
        <a-empty description="暂无画像" />
        <a-typography-text type="secondary" class="popup-empty-hint">
          该访客还没有聚合成画像：官网埋点未上报、画像采集关闭，或只剩历史会话都会出现这种情况。
        </a-typography-text>
      </div>

      <a-result
        v-else-if="state === 'error'"
        status="warning"
        title="画像加载失败"
        :subtitle="errorText"
        data-testid="profile-popup-error"
      >
        <template #extra>
          <a-button type="primary" size="small" @click="load">重试</a-button>
        </template>
      </a-result>

      <template v-else-if="state === 'ok' && profile">
        <a-descriptions
          :column="2"
          size="small"
          bordered
          class="popup-desc"
          data-testid="profile-popup-desc"
        >
          <a-descriptions-item label="国家 / 地区 / 城市">
            {{ regionText }}
          </a-descriptions-item>
          <a-descriptions-item label="时区">
            {{ textOr(profile.timezone) }}
          </a-descriptions-item>
          <a-descriptions-item label="推测国籍">
            <span v-if="profile.nationality_guess" data-testid="profile-popup-nationality">
              <a-tag size="small" color="arcoblue">推测</a-tag>
              <span class="guess-code">{{ profile.nationality_guess }}</span>
              <a-typography-text type="secondary">
                {{ confidencePercent(profile.nationality_confidence) }}%
              </a-typography-text>
            </span>
            <span v-else>暂无数据</span>
          </a-descriptions-item>
          <a-descriptions-item label="访问次数">
            {{ Number(profile.visits || 0) }}
          </a-descriptions-item>
          <a-descriptions-item label="浏览器">
            {{ device.browser }}
          </a-descriptions-item>
          <a-descriptions-item label="操作系统">
            {{ device.os }}
          </a-descriptions-item>
          <a-descriptions-item label="设备">
            {{ device.device }}
          </a-descriptions-item>
          <a-descriptions-item label="最近访问时间">
            {{ localTime(profile.last_seen_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="最近路径" :span="2">
            {{ textOr(profile.last_path) }}
          </a-descriptions-item>
          <a-descriptions-item label="访问记录" :span="2">
            {{ visitData ? `已关联最近一次访问 · ${localTime(visitData.occurred_at || visitData.occurredAt)}` : '未关联到官网访问记录' }}
          </a-descriptions-item>
          <a-descriptions-item label="来源" :span="2">
            {{ sourceText }}
          </a-descriptions-item>
          <a-descriptions-item label="IP" :span="2">
            {{ textOr(profile.ip_last) }}
          </a-descriptions-item>
        </a-descriptions>

        <div class="popup-section">
          <div class="section-label">国籍推测依据</div>
          <a-space
            v-if="asArray(profile.nationality_basis).length"
            size="mini"
            wrap
            data-testid="profile-popup-basis"
          >
            <a-tag
              v-for="basis in asArray(profile.nationality_basis)"
              :key="String(basis)"
              color="orange"
            >
              {{ basisLabel(basis) }}
            </a-tag>
          </a-space>
          <a-typography-text v-else type="secondary">暂无依据记录</a-typography-text>
        </div>

        <div class="popup-section">
          <div class="section-label">画像摘要</div>
          <a-typography-paragraph class="summary">
            {{ profile.summary || '暂无摘要' }}
          </a-typography-paragraph>
        </div>

        <a-typography-text v-if="deviceFallback" type="secondary" class="popup-footnote">
          未关联到最近一次官网访问，因此浏览器、操作系统、设备和最近路径暂无数据。请确认访客已同意分析 Cookie，并且访问的是新官网；本地 127.0.0.1 也无法解析国家/时区。
        </a-typography-text>
        <a-typography-text v-else type="secondary" class="popup-footnote">
          浏览器、操作系统、设备与最近路径来自最近一次官网访问；国家/时区来自 IP 地理库，本地或内网 IP 无法解析。
        </a-typography-text>
      </template>

      <a-empty v-else-if="state === 'missing'" description="该会话没有访客 ID，无法查看画像" />
    </a-spin>
  </a-modal>
</template>

<script lang="ts" setup>
  import { computed, ref, watch } from 'vue';
  import { fetchVisitorProfile, fetchVisitorVisits } from '@/api/admin';

  const props = defineProps<{
    visible: boolean;
    conversation: any | null;
  }>();
  const emit = defineEmits<{ (e: 'update:visible', value: boolean): void }>();

  const loading = ref(false);
  const profile = ref<any>(null);
  const visitData = ref<any>(null);
  const state = ref<'idle' | 'missing' | 'ok' | 'empty' | 'error'>('idle');
  const errorText = ref('');

  const BASIS_LABELS: Record<string, string> = {
    ip_cdn: 'CDN 头（CF-IPCountry 等）',
    geoip: '本地 GeoLite2 库',
    third_party: '第三方 IP 库',
    language: '语言线索',
    timezone: '时区线索',
  };

  const STATUS_LABELS: Record<string, string> = {
    online: '在线',
    busy: '忙碌',
    offline: '离线',
    waiting: '待接入',
    ai_serving: 'AI 接待',
    human_requested: '等待人工',
    assigned: '人工服务',
    closed: '已结束',
  };

  // 会话与画像的关联键必须与后端 domain.Conversation.ProfileKey() 一致：
  // 优先官网埋点的 profile_visitor_id（visitor_ref），为空时回落到引擎 visitor_id。
  const visitorId = computed(() =>
    String(
      props.conversation?.profile_visitor_id ||
        props.conversation?.visitor_id ||
        ''
    ).trim()
  );

  const regionText = computed(() => {
    const parts = [profile.value?.country, profile.value?.region, profile.value?.city]
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    return parts.length ? parts.join(' / ') : '暂无数据';
  });

  const sourceText = computed(() => {
    const raw =
      profile.value?.source ||
      profile.value?.referrer ||
      props.conversation?.source ||
      '';
    return String(raw ?? '').trim() || '暂无数据';
  });

  // 画像接口目前没有 UA / 设备维度；这里兼容后端未来可能补充的字段名，
  // 一个都取不到时统一显示「暂无数据」，并给出说明而不是留空。
  const device = computed(() => {
    const p = profile.value || {};
    const direct = {
      browser: textOr(p.browser, ''),
      os: textOr(p.os || p.operating_system, ''),
      device: textOr(p.device || p.device_type, ''),
    };
    const ua = String(p.user_agent || p.ua || '').trim();
    let fromUa = { browser: '', os: '', device: '' };
    if (ua) {
      fromUa = {
        browser: /Edg\//.test(ua)
          ? 'Edge'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /Firefox\//.test(ua)
                ? 'Firefox'
                : '未知',
        os: /Windows/.test(ua)
          ? 'Windows'
          : /Android/.test(ua)
            ? 'Android'
            : /iPhone|iPad|iOS/.test(ua)
              ? 'iOS'
              : /Mac OS X/.test(ua)
                ? 'macOS'
                : /Linux/.test(ua)
                  ? 'Linux'
                  : '未知',
        device: /Mobile|Android|iPhone/.test(ua)
          ? '移动端'
          : /iPad|Tablet/.test(ua)
            ? '平板'
            : '桌面端',
      };
    }
    const pick = (key: 'browser' | 'os' | 'device') =>
      direct[key] || fromUa[key] || '暂无数据';
    return { browser: pick('browser'), os: pick('os'), device: pick('device') };
  });

  const deviceFallback = computed(
    () =>
      state.value === 'ok' &&
      device.value.browser === '暂无数据' &&
      device.value.os === '暂无数据' &&
      device.value.device === '暂无数据'
  );

  function textOr(value: unknown, fallback = '暂无数据') {
    const raw = String(value ?? '').trim();
    return raw || fallback;
  }

  function asArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function basisLabel(basis: any) {
    const key = String(basis || '');
    return BASIS_LABELS[key] || key || '未知依据';
  }

  function confidencePercent(value: any) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(parsed > 1 ? parsed : parsed * 100)));
  }

  function statusLabel(value: string) {
    return STATUS_LABELS[value] || value || '-';
  }

  function statusColor(value: string) {
    return (
      {
        waiting: 'orange',
        human_requested: 'orangered',
        assigned: 'green',
        ai_serving: 'arcoblue',
        closed: 'gray',
      }[value] || 'gray'
    );
  }

  function localTime(value: unknown) {
    const raw = String(value ?? '');
    if (!raw) return '暂无数据';
    const time = Date.parse(raw);
    if (!Number.isFinite(time)) return raw;
    return new Date(time).toLocaleString('zh-CN', { hour12: false });
  }

  function backendMessage(reason: any, fallback: string) {
    return (
      reason?.response?.data?.error?.message ||
      reason?.response?.data?.message ||
      reason?.message ||
      fallback
    );
  }

  async function load() {
    const id = visitorId.value;
    profile.value = null;
    visitData.value = null;
    errorText.value = '';
    if (!id) {
      state.value = 'missing';
      return;
    }
    loading.value = true;
    state.value = 'idle';
    try {
      const [payload, visits] = await Promise.all([
        fetchVisitorProfile(id),
        fetchVisitorVisits(id).catch(() => []),
      ]);
      const detail = payload?.profile ?? payload ?? null;
      if (!detail || typeof detail !== 'object' || !Object.keys(detail).length) {
        state.value = 'empty';
        return;
      }
      const latest = Array.isArray(visits) ? (visits.find((item: any) => item?.isBot !== true) || visits[0] || null) : null;
      visitData.value = latest;
      profile.value = latest
        ? {
            ...detail,
            country: detail.country || latest.country || '',
            browser: detail.browser || latest.browser || '',
            os: detail.os || latest.os || '',
            device: detail.device || latest.device || '',
            last_path: detail.last_path || latest.path || '',
            referrer: detail.referrer || latest.referrer || '',
            last_seen_at: detail.last_seen_at || latest.occurred_at || latest.occurredAt || null,
          }
        : detail;
      state.value = 'ok';
    } catch (reason: any) {
      // 404 = 引擎里没有这条画像，属于正常空态，不算错误。
      const status = Number(reason?.response?.status || 0);
      if (status === 404) {
        state.value = 'empty';
        return;
      }
      state.value = 'error';
      errorText.value = backendMessage(reason, '画像加载失败，请稍后重试。');
    } finally {
      loading.value = false;
    }
  }

  function close() {
    emit('update:visible', false);
  }

  watch(
    () => props.visible,
    (next) => {
      if (next) load();
    }
  );
</script>

<style scoped lang="less">
  .popup-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .popup-id {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mono {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 12px;
  }
  .popup-empty {
    padding: 24px 0;
  }
  .popup-empty-hint {
    display: block;
    max-width: 440px;
    margin: 6px auto 0;
    font-size: 12px;
    line-height: 18px;
    text-align: center;
  }
  .popup-desc {
    margin-bottom: 12px;
  }
  .guess-code {
    margin: 0 6px;
    font-weight: 600;
  }
  .popup-section {
    margin-top: 12px;
  }
  .section-label {
    margin-bottom: 6px;
    color: var(--color-text-3);
    font-size: 12px;
  }
  .summary {
    margin-bottom: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .popup-footnote {
    display: block;
    margin-top: 12px;
    font-size: 12px;
    line-height: 18px;
  }
</style>
