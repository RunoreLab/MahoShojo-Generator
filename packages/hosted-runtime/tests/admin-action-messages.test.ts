import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_MESSAGE_ACTIONS } from '../src/admin/actions/messages';
import { adminActionVersion } from '../src/admin/actions/core';
import { adminManagementFixture } from './admin-management-fixture';

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));
const setup = async () => {
  const fixture = await adminManagementFixture(['messages.write']);
  closers.push(() => fixture.sqlite.close());
  fixture.sqlite.exec("INSERT INTO users(id,username,auth_key,email) VALUES (1,'one','fixture','one@example.test'),(2,'two','fixture-two','two@example.test')");
  return fixture;
};
const action = (name: string) => ADMIN_MESSAGE_ACTIONS.find((entry) => entry.name === name)!;
const common = { reason: '通知测试', idempotencyKey: 'message-request' };

describe('Admin message actions', () => {
  it('creates a site message once with separate admin attribution and rejects unsafe URLs', async () => {
    const { db, sqlite, context } = await setup();
    const input = { ...common, templateKey: 'site.generic.notice', payload: { title: '<script>text</script>', body: 'notice' }, actionUrl: '/news' };
    await action('messages.site.create').execute(db, input, context);
    await action('messages.site.create').execute(db, input, context);
    const rows = sqlite.prepare('SELECT created_by_user_id,created_by_admin_principal_id,payload_json FROM site_messages').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ created_by_user_id: null, created_by_admin_principal_id: 'operator' });
    for (const actionUrl of ['javascript:alert(1)', '//evil.example', '/\\evil.example', '/path\nheader']) {
      await expect(action('messages.site.create').execute(db, { ...input, actionUrl }, context)).rejects.toThrow();
    }
  });

  it('sends bounded direct messages atomically and never partially accepts missing recipients', async () => {
    const { db, sqlite, context } = await setup();
    const input = { ...common, templateKey: 'user.generic.notice', recipientUserIds: [1, 2], bodyText: 'hello' };
    expect(await action('messages.direct.create').execute(db, input, context)).toMatchObject({ status: 'succeeded', result: { createdCount: 2 } });
    await action('messages.direct.create').execute(db, input, context);
    expect(sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(2);
    expect(await action('messages.direct.create').execute(db, { ...input, idempotencyKey: 'missing', recipientUserIds: [1, 99] }, context)).toMatchObject({ status: 'conflict' });
    expect(sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(2);
    await expect(action('messages.direct.create').execute(db, { ...input, recipientUserIds: [1, 1] }, context)).rejects.toThrow();
    await expect(action('messages.direct.create').execute(db, { ...input, recipientUserIds: Array.from({ length: 101 }, (_, i) => i + 1) }, context)).rejects.toThrow();
  });

  it('expires a site message using its complete observed revision and keeps stale requests inert', async () => {
    const { db, sqlite, context } = await setup();
    await action('messages.site.create').execute(db, { ...common, templateKey: 'site.generic.notice' }, context);
    const row = sqlite.prepare('SELECT * FROM site_messages').get()!;
    const version = await adminActionVersion('messages', row);
    const expire = { ...common, idempotencyKey: 'expire', id: String(row.id), expectedVersion: version };
    expect(await action('messages.site.expire').execute(db, expire, context)).toMatchObject({ status: 'succeeded' });
    expect(await action('messages.site.expire').execute(db, { ...expire, idempotencyKey: 'stale' }, context)).toMatchObject({ status: 'conflict' });
  });

  it('rolls back sending when mandatory audit persistence fails', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT,'fixture'); END");
    await expect(action('messages.direct.create').execute(db, { ...common, templateKey: 'user.generic.notice', recipientUserIds: [1, 2] }, context)).rejects.toThrow();
    expect(sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(0);
  });
});
