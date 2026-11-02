import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { createVerification } from './verification.mjs';
import { createMailer } from './mailer.mjs';

/** 极简 SMTP 接收端：够 SMTP 客户端跑完握手与投递，把 DATA 内容留下来。 */
async function startSink() {
  const received = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.write('220 sink ready\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') { inData = false; received.push(1); socket.write('250 queued\r\n'); continue; }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (upper === 'STARTTLS') socket.write('220 go ahead\r\n');
        else if (upper.startsWith('AUTH')) socket.write('235 ok\r\n');
        else if (upper.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
        else if (upper.startsWith('RCPT TO')) socket.write('250 ok\r\n');
        else if (upper === 'DATA') { inData = true; socket.write('354 end with .\r\n'); }
        else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, received, port: server.address().port };
}

function memoryStore() {
  const codes = [];
  return {
    codes,
    async query(sql, params = []) {
      if (sql.includes('FROM email_verification_codes') && sql.includes("created_at > now() - interval '1 hour'")) {
        return { rows: codes.filter((row) => row.email === params[0]).map((row) => ({ id: row.id, attempts: row.attempts, created_at: row.created_at, used_at: row.used_at })) };
      }
      if (sql.startsWith('UPDATE email_verification_codes SET used_at = now() WHERE lower(email)')) {
        for (const row of codes) if (row.email === params[0]) row.used_at = row.used_at || new Date().toISOString();
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO email_verification_codes')) {
        codes.unshift({ id: params[0], email: params[1], purpose: params[2], code_hash: params[3], expires_at: params[4], attempts: 0, used_at: null, created_at: new Date().toISOString() });
        return { rows: [] };
      }
      if (sql.startsWith('SELECT * FROM email_verification_codes')) {
        const row = codes.find((item) => item.email === params[0] && !item.used_at);
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('UPDATE email_verification_codes SET attempts')) {
        const row = codes.find((item) => item.id === params[0]);
        if (row) row.attempts += 1;
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE email_verification_codes SET used_at = now() WHERE id')) {
        const row = codes.find((item) => item.id === params[0]);
        if (row) row.used_at = new Date().toISOString();
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

test('验证码：下发、校验、一次性、错误计数', async (t) => {
  const sink = await startSink();
  t.after(() => sink.server.close());
  const store = memoryStore();
  const sent = [];
  const mailer = {
    async send(options) { sent.push(options); }
  };
  const verification = createVerification({ store, mailer, json: () => {}, bodyJson: async () => ({}), applyPublicCors: () => true, resolveClient: () => ({ ip: '1.1.1.1' }), secret: 'test-secret' });

  const issued = await verification.issue('buyer@example.com', 'register');
  assert.equal(issued.throttled, 0);
  assert.equal(sent.length, 1);
  const code = sent[0].text.match(/\d{6}/)[0];

  assert.equal((await verification.verify('buyer@example.com', '000000' === code ? '111111' : '000000')).ok, false);
  assert.equal(store.codes[0].attempts, 1);
  assert.equal((await verification.verify('buyer@example.com', code)).ok, true);
  // 用过就作废
  assert.equal((await verification.verify('buyer@example.com', code)).ok, false);

  // 60 秒内重发被挡住
  const again = await verification.issue('buyer@example.com', 'register');
  assert.ok(again.throttled > 0);
});

test('邮件发送：成功与失败都会留痕', async (t) => {
  const sink = await startSink();
  t.after(() => sink.server.close());
  const logged = [];
  const store = {
    readRuntimeSetting: async () => ({ config: { host: '127.0.0.1', port: sink.port, secure: false, fromEmail: 'no-reply@example.com', fromName: 'Hongmeng' }, secrets: { password: '' } }),
    logMail: async (entry) => logged.push(entry)
  };
  const mailer = createMailer({ platformStore: store, recordSystemEvent: async () => {} });
  await mailer.send({ to: 'a@example.com', subject: '测试', text: '正文', purpose: 'register' });
  assert.equal(logged.at(-1).status, 'sent');
  assert.equal(sink.received.length, 1);

  const broken = createMailer({ platformStore: { ...store, readRuntimeSetting: async () => ({ config: { host: '127.0.0.1', port: 1 }, secrets: {} }) }, recordSystemEvent: async () => {} });
  await assert.rejects(() => broken.send({ to: 'a@example.com', subject: 'x', text: 'y' }));
  assert.equal(logged.at(-1).status, 'failed');
});
