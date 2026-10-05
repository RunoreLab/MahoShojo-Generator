import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_BUSINESS_ACTIONS, adminActionVersion, type AdminVersionResource } from '../src/admin/business-actions';
import { adminManagementFixture } from './admin-management-fixture';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((close) => close()));
async function setup() {
  const fixture = await adminManagementFixture(['content.write', 'tags.write', 'users.write', 'badges.write', 'redemption.write']);
  cleanups.push(() => fixture.sqlite.close());
  fixture.sqlite.exec('PRAGMA foreign_keys=ON');
  const columns = fixture.sqlite.prepare('PRAGMA table_info(user_messages)').all().map((column) => column.name);
  if (!columns.includes('created_by_admin_principal_id')) fixture.sqlite.exec('ALTER TABLE user_messages ADD COLUMN created_by_admin_principal_id TEXT REFERENCES admin_principals(id)');
  fixture.sqlite.exec(`INSERT INTO users (id,username,email,auth_key) VALUES (1,'fixture','fixture@example.test','fixture-key');
    INSERT INTO data_cards (id,user_id,type,name,description,data,is_public,review_status,is_recommended,created_at,updated_at)
      VALUES ('card',1,'character','原名','原描述','{"name":"原名"}',0,'pending',0,'2026-01-01','2026-01-01');`);
  return fixture;
}
async function version(fixture: Awaited<ReturnType<typeof setup>>, resource: AdminVersionResource, sql = 'SELECT * FROM data_cards WHERE id=\'card\'') {
  return adminActionVersion(resource, fixture.sqlite.prepare(sql).get()!);
}
function run(fixture: Awaited<ReturnType<typeof setup>>, action: string, input: Record<string, unknown>) {
  const definition = ADMIN_BUSINESS_ACTIONS.find((item) => item.name === action);
  if (!definition) throw new Error(`Unknown test action ${action}`);
  return definition.execute(fixture.db, { reason: '核实后的处理原因', idempotencyKey: crypto.randomUUID(), ...input }, fixture.context);
}

describe('Admin content actions', () => {
  it('rejects a card with exactly one canonical notification and replays without side effects', async () => {
    const fixture = await setup();
    const input = { id: 'card', expectedVersion: await version(fixture, 'data-cards'), decision: 'rejected', idempotencyKey: 'reject-once' };
    const result = await run(fixture, 'cards.review', input);
    expect(result).toMatchObject({ status: 'succeeded', replayed: false });
    expect(await run(fixture, 'cards.review', input)).toMatchObject({ status: 'succeeded', replayed: true });
    const messages = fixture.sqlite.prepare('SELECT * FROM user_messages').all();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ recipient_user_id: 1, actor_user_id: null, created_by_admin_principal_id: 'operator', template_key: 'user.moderation.data_card_rejected' });
    expect(JSON.parse(messages[0].payload_json as string)).toMatchObject({ dataCardId: 'card', dataCardName: '原名', reason: '核实后的处理原因' });
  });

  it('detects same-second legacy changes before and during the operation without notifications', async () => {
    const fixture = await setup();
    const expectedVersion = await version(fixture, 'data-cards');
    fixture.sqlite.exec("UPDATE data_cards SET name='已被用户修改' WHERE id='card'");
    expect(await run(fixture, 'cards.review', { id: 'card', expectedVersion, decision: 'rejected' })).toMatchObject({ status: 'conflict' });
    const latestVersion = await version(fixture, 'data-cards');
    const originalBatch = fixture.db.batch;
    fixture.db.batch = (statements) => { fixture.sqlite.exec("UPDATE data_cards SET description='读取后并发修改' WHERE id='card'"); return originalBatch(statements); };
    expect(await run(fixture, 'cards.review', { id: 'card', expectedVersion: latestVersion, decision: 'rejected' })).toMatchObject({ status: 'conflict' });
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM user_messages').get()?.n).toBe(0);
    expect(fixture.sqlite.prepare("SELECT review_status FROM data_cards WHERE id='card'").get()?.review_status).toBe('pending');
  });

  it('preserves the three visibility states and updates public_since on transitions', async () => {
    const fixture = await setup();
    for (const visibility of [1, 0, -1]) {
      expect(await run(fixture, 'cards.visibility', { id: 'card', expectedVersion: await version(fixture, 'data-cards'), visibility })).toMatchObject({ status: 'succeeded' });
      const row = fixture.sqlite.prepare('SELECT is_public,public_since FROM data_cards').get()!;
      expect(row.is_public).toBe(visibility);
      expect(row.public_since === null).toBe(visibility !== 1);
    }
  });

  it('rolls back card state, notification and operation claim if success audit fails', async () => {
    const fixture = await setup();
    fixture.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT,'audit failure'); END");
    await expect(run(fixture, 'cards.review', { id: 'card', expectedVersion: await version(fixture, 'data-cards'), decision: 'rejected' })).rejects.toThrow('audit failure');
    expect(fixture.sqlite.prepare('SELECT review_status FROM data_cards').get()?.review_status).toBe('pending');
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM user_messages').get()?.n).toBe(0);
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM admin_operations').get()?.n).toBe(0);
  });

  it('applies an update atomically and consumes it; stale card versions retain pending updates', async () => {
    const fixture = await setup();
    fixture.sqlite.exec("INSERT INTO data_card_updates (id,data_card_id,user_id,name,data,created_at,updated_at) VALUES ('update','card',1,'新名','{\"name\":\"新名\"}','2026-01-01','2026-01-01')");
    fixture.sqlite.exec("INSERT INTO arena_ratings (entity_type,entity_id,queue,rating,games,wins,losses,draws,created_at,updated_at,season_peak_rating,season_peak_games,season_peak_at,season_peak_tier,season_low_rating,season_low_games,season_low_at,last_delta,last_applied_at) VALUES ('data_card','card','strict',1300,4,3,1,0,'2026-01-01','2026-01-01',1400,3,'2026-01-01','金牌',1000,0,'2026-01-01',20,'2026-01-01'),('data_card','card','free',1500,8,5,3,0,'2026-01-01','2026-01-01',1500,8,'2026-01-01','金牌',1000,0,'2026-01-01',10,'2026-01-01')");
    const input = { id: 'update', expectedVersion: await version(fixture, 'data-card-updates', "SELECT * FROM data_card_updates WHERE id='update'"), cardId: 'card', cardVersion: 'stale', decision: 'approved' };
    expect(await run(fixture, 'card-updates.review', input)).toMatchObject({ status: 'conflict' });
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM data_card_updates').get()?.n).toBe(1);
    expect(fixture.sqlite.prepare("SELECT rating FROM arena_ratings WHERE queue='strict'").get()?.rating).toBe(1300);
    expect(await run(fixture, 'card-updates.review', { ...input, cardVersion: await version(fixture, 'data-cards') })).toMatchObject({ status: 'succeeded' });
    expect(fixture.sqlite.prepare('SELECT name,review_status FROM data_cards').get()).toMatchObject({ name: '新名', review_status: 'approved' });
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM data_card_updates').get()?.n).toBe(0);
    expect(fixture.sqlite.prepare("SELECT rating,games,season_peak_rating,season_peak_tier,last_delta FROM arena_ratings WHERE queue='strict'").get()).toEqual({ rating: 1000, games: 0, season_peak_rating: 1000, season_peak_tier: '无牌', last_delta: null });
    expect(fixture.sqlite.prepare("SELECT rating,games FROM arena_ratings WHERE queue='free'").get()).toEqual({ rating: 1500, games: 8 });
  });

  it('notifies the pending update owner before consuming a rejected update', async () => {
    const fixture = await setup();
    fixture.sqlite.exec("INSERT INTO data_card_updates (id,data_card_id,user_id,name,updated_at) VALUES ('update','card',1,'送审新名','2026-01-01')");
    expect(await run(fixture, 'card-updates.review', { id: 'update', expectedVersion: await version(fixture, 'data-card-updates', "SELECT * FROM data_card_updates WHERE id='update'"), cardId: 'card', cardVersion: await version(fixture, 'data-cards'), decision: 'rejected' })).toMatchObject({ status: 'succeeded' });
    expect(JSON.parse(fixture.sqlite.prepare('SELECT payload_json FROM user_messages').get()?.payload_json as string).dataCardName).toBe('送审新名');
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM data_card_updates').get()?.n).toBe(0);
  });

  it('keeps the current administrator-only native permission when approving an old questionnaire update', async () => {
    const fixture = await setup();
    fixture.sqlite.exec(`UPDATE data_cards SET type='questionnaire',data='{"nativeAllowed":false}';
      INSERT INTO data_card_updates (id,data_card_id,user_id,data,updated_at) VALUES ('update','card',1,'{"nativeAllowed":true,"name":"更新"}','2026-01-01')`);
    expect(await run(fixture, 'card-updates.review', { id: 'update', expectedVersion: await version(fixture, 'data-card-updates', "SELECT * FROM data_card_updates WHERE id='update'"), cardId: 'card', cardVersion: await version(fixture, 'data-cards'), decision: 'approved' })).toMatchObject({ status: 'succeeded' });
    expect(JSON.parse(fixture.sqlite.prepare('SELECT data FROM data_cards').get()?.data as string)).toEqual({ nativeAllowed: false, name: '更新' });
  });

  it('rejects unregistered fields and confines native permission to questionnaire cards', async () => {
    const fixture = await setup();
    const expectedVersion = await version(fixture, 'data-cards');
    await expect(run(fixture, 'cards.review', { id: 'card', expectedVersion, decision: 'approved', authKey: 'injected' })).rejects.toThrow();
    expect(await run(fixture, 'cards.native-allowed', { id: 'card', expectedVersion, nativeAllowed: true })).toMatchObject({ status: 'conflict' });
    fixture.sqlite.exec("UPDATE data_cards SET type='questionnaire'");
    expect(await run(fixture, 'cards.native-allowed', { id: 'card', expectedVersion: await version(fixture, 'data-cards'), nativeAllowed: true })).toMatchObject({ status: 'succeeded' });
    expect(JSON.parse(fixture.sqlite.prepare('SELECT data FROM data_cards').get()?.data as string).nativeAllowed).toBe(true);
  });
});

describe('Admin tag actions', () => {
  it('creates and versions tags and aliases; deleting a tag keeps historical associations', async () => {
    const fixture = await setup();
    expect(await run(fixture, 'tags.create', { id: 't', name: '标签', description: null, category: null, scope: 'user', isActive: true })).toMatchObject({ status: 'succeeded' });
    expect(await run(fixture, 'tag-aliases.create', { id: 'alias', tagId: 't' })).toMatchObject({ status: 'succeeded' });
    expect(await run(fixture, 'tags.disable', { id: 't', expectedVersion: await version(fixture, 'tags', "SELECT * FROM tags WHERE id='t'") })).toMatchObject({ status: 'succeeded' });
    expect(fixture.sqlite.prepare('SELECT is_active FROM tags').get()?.is_active).toBe(0);
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM tag_aliases').get()?.n).toBe(1);
    expect(await run(fixture, 'tag-aliases.delete', { id: 'alias', expectedVersion: 'stale' })).toMatchObject({ status: 'conflict' });
    expect(await run(fixture, 'tag-aliases.delete', { id: 'alias', expectedVersion: await version(fixture, 'tag-aliases', "SELECT * FROM tag_aliases WHERE alias='alias'") })).toMatchObject({ status: 'succeeded' });
  });

  it('replaces only the chosen scope and refuses missing/inactive tags before clearing anything', async () => {
    const fixture = await setup();
    for (const [id, scope] of [['old', 'user'], ['new', 'user'], ['admin', 'admin']]) await run(fixture, 'tags.create', { id, name: id, description: null, category: null, scope, isActive: true });
    fixture.sqlite.exec("INSERT INTO data_card_tags (data_card_id,tag_id,created_at) VALUES ('card','old','2026-01-01'),('card','admin','2026-01-01')");
    const input = { id: 'card', expectedVersion: await version(fixture, 'data-cards'), scope: 'user', expectedTagIds: ['old'], tagIds: ['missing'] };
    expect(await run(fixture, 'cards.tags', input)).toMatchObject({ status: 'conflict' });
    expect(fixture.sqlite.prepare('SELECT tag_id FROM data_card_tags ORDER BY tag_id').all()).toEqual([{ tag_id: 'admin' }, { tag_id: 'old' }]);
    expect(await run(fixture, 'cards.tags', { ...input, tagIds: ['new'] })).toMatchObject({ status: 'succeeded' });
    expect(fixture.sqlite.prepare('SELECT tag_id FROM data_card_tags ORDER BY tag_id').all()).toEqual([{ tag_id: 'admin' }, { tag_id: 'new' }]);
  });
});

describe('Admin user and entitlement actions', () => {
  const badge = { id: 'test-badge', name: '测试徽章', description: null, icon: { type: 'emoji', value: '⭐' }, textColor: { type: 'solid', value: '#000000' }, backgroundColor: { type: 'solid', value: '#ffffff' }, borderColor: null, rarity: 1, sortOrder: 0, isActive: true };

  it('modifies only named user attributes and maps zero slots to the existing default-capacity behavior', async () => {
    const fixture = await setup();
    const userVersion = () => version(fixture, 'users', 'SELECT * FROM users WHERE id=1');
    expect(await run(fixture, 'users.ban', { id: '1', expectedVersion: await userVersion(), banned: true })).toMatchObject({ status: 'succeeded' });
    expect(fixture.sqlite.prepare('SELECT is_banned FROM users WHERE id=1').get()?.is_banned).toBe('核实后的处理原因');
    expect(await run(fixture, 'users.ban', { id: '1', expectedVersion: await userVersion(), banned: false })).toMatchObject({ status: 'succeeded' });
    expect(await run(fixture, 'users.slots', { id: '1', expectedVersion: await userVersion(), slotCount: 100 })).toMatchObject({ status: 'succeeded' });
    expect(await run(fixture, 'users.slots', { id: '1', expectedVersion: await userVersion(), slotCount: 0 })).toMatchObject({ status: 'succeeded' });
    expect(fixture.sqlite.prepare('SELECT is_banned,slot_count,is_admin,auth_key FROM users WHERE id=1').get()).toMatchObject({ is_banned: null, slot_count: null, is_admin: 0, auth_key: 'fixture-key' });
    await expect(run(fixture, 'users.slots', { id: '1', expectedVersion: await userVersion(), slotCount: 100, isAdmin: true })).rejects.toThrow();
  });

  it('validates badge presentation fields and grants a badge and message once per assignment', async () => {
    const fixture = await setup();
    await expect(run(fixture, 'badges.create', { ...badge, icon: { type: 'svg', url: 'javascript:alert(1)' } })).rejects.toThrow();
    await expect(run(fixture, 'badges.create', { ...badge, backgroundColor: { type: 'gradient', value: 'linear-gradient(url(https://invalid.test))' } })).rejects.toThrow();
    expect(await run(fixture, 'badges.create', badge)).toMatchObject({ status: 'succeeded' });
    const expectedVersion = await version(fixture, 'badges', "SELECT * FROM badges WHERE id='test-badge'");
    const grant = { id: badge.id, expectedVersion, userId: 1, idempotencyKey: 'grant-once' };
    expect(await run(fixture, 'badges.grant', grant)).toMatchObject({ status: 'succeeded' });
    expect(await run(fixture, 'badges.grant', grant)).toMatchObject({ status: 'succeeded', replayed: true });
    expect(await run(fixture, 'badges.grant', { ...grant, idempotencyKey: 'duplicate-assignment' })).toMatchObject({ status: 'conflict' });
    expect(fixture.sqlite.prepare("SELECT count(*) n FROM user_badges WHERE badge_id='test-badge'").get()?.n).toBe(1);
    expect(fixture.sqlite.prepare("SELECT count(*) n FROM user_messages WHERE template_key='user.reputation.badge_awarded'").get()?.n).toBe(1);
    expect(await run(fixture, 'badges.delete', { id: badge.id, expectedVersion })).toMatchObject({ status: 'conflict' });
    const owned = fixture.sqlite.prepare("SELECT id,obtained_at FROM user_badges WHERE badge_id='test-badge'").get()!;
    expect(await run(fixture, 'badges.revoke', { id: badge.id, userId: 1, assignmentId: owned.id, obtainedAt: owned.obtained_at })).toMatchObject({ status: 'succeeded' });
    expect(await run(fixture, 'badges.delete', { id: badge.id, expectedVersion })).toMatchObject({ status: 'succeeded' });
  });

  it('does not revoke a newly reacquired badge using a stale assignment ID', async () => {
    const fixture = await setup();
    await run(fixture, 'badges.create', badge);
    const expectedVersion = await version(fixture, 'badges', "SELECT * FROM badges WHERE id='test-badge'");
    await run(fixture, 'badges.grant', { id: badge.id, expectedVersion, userId: 1 });
    const old = fixture.sqlite.prepare("SELECT id,obtained_at FROM user_badges WHERE badge_id='test-badge'").get()!;
    fixture.sqlite.exec("DELETE FROM user_badges WHERE badge_id='test-badge'");
    await run(fixture, 'badges.grant', { id: badge.id, expectedVersion, userId: 1 });
    expect(await run(fixture, 'badges.revoke', { id: badge.id, userId: 1, assignmentId: old.id, obtainedAt: old.obtained_at })).toMatchObject({ status: 'conflict' });
  });

  it('generates a bounded batch atomically, replays the same codes and avoids raw code audit targets', async () => {
    const fixture = await setup();
    const input = { count: 100, slotCount: 10, idempotencyKey: 'generate-once' };
    const first = await run(fixture, 'redemption.generate', input) as { result: { codes: string[] } };
    const replay = await run(fixture, 'redemption.generate', input) as { result: { codes: string[] }; replayed: boolean };
    expect(replay.result.codes).toEqual(first.result.codes);
    expect(replay.replayed).toBe(true);
    expect(new Set(first.result.codes).size).toBe(100);
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM redemption_codes').get()?.n).toBe(100);
    const code = first.result.codes[0];
    const row = fixture.sqlite.prepare('SELECT rowid,* FROM redemption_codes WHERE code=?').get(code)!;
    expect(await run(fixture, 'redemption.delete', { id: String(row.rowid), expectedVersion: await adminActionVersion('redemption-codes', row) })).toMatchObject({ status: 'succeeded' });
    expect(JSON.stringify(fixture.sqlite.prepare('SELECT * FROM admin_audit_events').all())).not.toContain(code);
    await expect(run(fixture, 'redemption.generate', { count: 101, slotCount: 1 })).rejects.toThrow();
  });
});
