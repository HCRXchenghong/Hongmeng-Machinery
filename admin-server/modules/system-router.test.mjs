import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemRouter } from '/Users/seron-cheng/Desktop/Hongmeng Machinery/admin-server/modules/system-router.mjs';

const make = () => {
  const replies = [];
  const router = createSystemRouter({
    platformStore: {},
    json: (_res, status, payload) => replies.push({ status, payload }),
    bodyJson: async () => ({}),
    verifySession: () => true,
    auditEvent: async () => {},
    serviceBridgeStatus: async () => ({}),
    rebuildStatus: () => ({}),
    storageHealth: async () => ({}),
    aiCapability: async () => ({}),
    translationSettings: async () => ({}),
    serviceBridgeAudit: async () => []
  });
  return { router: router.handle, replies };
};

test('邮件接口不被系统路由拦截', async () => {
  const { router, replies } = make();
  const handled = await router({ method: 'PATCH', url: '/site-admin-api/system/mail-settings', headers: {} }, {}, '/site-admin-api/system/mail-settings');
  assert.equal(handled, false, '应交给 mailer router 处理');
  assert.equal(replies.length, 0, '不应直接返回 404');
});

test('未知的系统接口仍然 404', async () => {
  const { router, replies } = make();
  const handled = await router({ method: 'GET', url: '/site-admin-api/system/nope', headers: {} }, {}, '/site-admin-api/system/nope');
  assert.equal(handled, true);
  assert.equal(replies[0].status, 404);
});
