import { afterEach, describe, expect, it } from 'vitest';
import { adminManagementFixture } from './admin-management-fixture';
import { readAdminArenaRisk, readAdminPvpRoomDetail } from '../src/admin/arena-management';
import { ADMIN_ARENA_ACTIONS } from '../src/admin/actions/arena';
import { adminActionVersion } from '../src/admin/actions/core';

const close: (() => void)[] = [];
afterEach(() => close.splice(0).forEach((fn) => fn()));
async function setup() {
  const fixture = await adminManagementFixture(['ratings.write', 'pvp-rooms.write']);
  close.push(() => fixture.sqlite.close());
  fixture.sqlite.exec("INSERT INTO users(id,username,email,auth_key) VALUES(1,'host','private@example.com','secret')");
  fixture.sqlite.exec(`INSERT INTO pvp_rooms(id,host_user_id,status,phase,rules_json,current_match_id,join_code_hash,join_code_salt,version,created_at,updated_at,last_activity_at)
    VALUES('room',1,'open','choosing','{"participants":2,"cardsPerPlayer":1,"submissionMode":"perPlayer","_drawPile":["secret-deck"]}','match','secret-hash','secret-salt',1,'2020-01-01','2020-01-01','2020-01-01')`);
  fixture.sqlite.exec("INSERT INTO pvp_matches(id,room_id,status,rules_json,participants,started_at,created_at,updated_at) VALUES('match','room','active','{}',2,'2020-01-01','2020-01-01','2020-01-01')");
  fixture.sqlite.exec("INSERT INTO pvp_rounds(id,room_id,match_id,round_index,status,created_at) VALUES('round','room','match',1,'pending','2020-01-01')");
  fixture.sqlite.exec("INSERT INTO pvp_room_hands VALUES('room',1,'{\"cards\":[],\"discarded\":[]}','2020-01-01','2020-01-01')");
  return fixture;
}
const action = (name: string) => { const found = ADMIN_ARENA_ACTIONS.find((item) => item.name === name); if (!found) throw new Error(name); return found; };

describe('Admin legacy arena interventions', () => {
  it('shows bounded details without room credentials or hidden deck state', async () => {
    const { db } = await setup();
    const detail = await readAdminPvpRoomDetail(db, 'room');
    expect(detail?.matches.items).toHaveLength(1);
    expect(detail?.rounds.items).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toMatch(/secret|auth_key|join_code|_drawPile/);
    expect((await readAdminArenaRisk(db)).summary).toBeDefined();
  });
  it('CAS conflict does not abort matches or delete runtime state', async () => {
    const { db, sqlite, context } = await setup();
    const result = await action('pvp-rooms.restart').execute(db, { id: 'room', expectedVersion: 99, reason: '重开卡住的房间', idempotencyKey: 'restart' }, context);
    expect(result).toHaveProperty('status', 'conflict');
    expect(sqlite.prepare("SELECT status FROM pvp_matches WHERE id='match'").get()?.status).toBe('active');
    expect(sqlite.prepare('SELECT count(*) AS n FROM pvp_room_hands').get()?.n).toBe(1);
  });
  it('restart aborts once, clears state after CAS and replays without further effects', async () => {
    const { db, sqlite, context } = await setup();
    const input = { id: 'room', expectedVersion: 1, reason: '重开卡住的房间', idempotencyKey: 'restart' };
    expect(await action('pvp-rooms.restart').execute(db, input, context)).toHaveProperty('status', 'succeeded');
    expect(await action('pvp-rooms.restart').execute(db, input, context)).toHaveProperty('replayed', true);
    expect(sqlite.prepare("SELECT version FROM pvp_rooms WHERE id='room'").get()?.version).toBe(2);
    expect(sqlite.prepare("SELECT status FROM pvp_matches WHERE id='match'").get()?.status).toBe('aborted');
    expect(sqlite.prepare('SELECT count(*) AS n FROM pvp_room_hands').get()?.n).toBe(0);
  });
  it('blocks intervention when resolving generation has no terminal proof', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("UPDATE pvp_rooms SET phase='resolving'; UPDATE pvp_rounds SET status='resolving'");
    const input = { id: 'room', expectedVersion: 1, reason: '恢复卡住的房间', idempotencyKey: 'recover' };
    expect(await action('pvp-rooms.recover').execute(db, input, context)).toHaveProperty('status', 'conflict');
    expect(sqlite.prepare("SELECT status FROM pvp_rounds WHERE id='round'").get()?.status).toBe('resolving');
  });
  it('restores completed result to reviewing without rating or duplicate settlement', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("UPDATE pvp_rooms SET phase='resolving'; UPDATE pvp_rounds SET status='resolving',result_json='{}'");
    const input = { id: 'room', expectedVersion: 1, reason: '恢复已结束生成', idempotencyKey: 'recover' };
    expect(await action('pvp-rooms.recover').execute(db, input, context)).toHaveProperty('status', 'succeeded');
    expect(sqlite.prepare("SELECT phase FROM pvp_rooms WHERE id='room'").get()?.phase).toBe('reviewing');
    expect(sqlite.prepare('SELECT count(*) AS n FROM arena_rating_events').get()?.n).toBe(0);
  });
  it('rolls back all intervention effects if audit insert fails', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT,'audit failed'); END");
    await expect(action('pvp-rooms.close').execute(db, { id: 'room', expectedVersion: 1, reason: '关闭卡住的房间', idempotencyKey: 'close' }, context)).rejects.toThrow();
    expect(sqlite.prepare("SELECT status FROM pvp_matches WHERE id='match'").get()?.status).toBe('active');
    expect(sqlite.prepare('SELECT count(*) AS n FROM pvp_room_hands').get()?.n).toBe(1);
  });
  it('resets a rating with full revision CAS while retaining rating event history and season extrema', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("INSERT INTO arena_ratings(entity_type,entity_id,queue,rating,games,wins,losses,draws,season_peak_rating,created_at,updated_at) VALUES('data_card','card','strict',1400,8,6,2,0,1500,'2020','2020')");
    const row = sqlite.prepare("SELECT * FROM arena_ratings WHERE entity_id='card'").get()!;
    const expectedVersion = await adminActionVersion('ratings', row);
    const result = await action('ratings.reset').execute(db, { id: '["data_card","card","strict"]', expectedVersion, reason: '重置错误积分', idempotencyKey: 'rating' }, context);
    expect(result).toHaveProperty('status', 'succeeded');
    expect(sqlite.prepare("SELECT rating,games,season_peak_rating FROM arena_ratings WHERE entity_id='card'").get()).toMatchObject({ rating: 1000, games: 0, season_peak_rating: 1500 });
  });
  it('forces only the last overdue player and does not dispatch or settle a generation', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("INSERT INTO pvp_room_players VALUES('room',1,'player',0,'2020-01-01')");
    sqlite.exec(`UPDATE pvp_room_hands SET hand_json='{"cards":[{"kind":"snapshot","id":"card-snapshot"}],"discarded":[]}'`);
    sqlite.exec("INSERT INTO pvp_room_card_snapshots VALUES('card-snapshot','room',1,'{}','character','test','{}',NULL,'2020-01-01')");
    const input = { id: 'room', expectedVersion: 1, reason: '最后玩家已超时', idempotencyKey: 'choice' };
    expect(await action('pvp-rooms.force-choose').execute(db, input, context)).toHaveProperty('status', 'succeeded');
    expect(await action('pvp-rooms.force-choose').execute(db, input, context)).toHaveProperty('replayed', true);
    expect(sqlite.prepare('SELECT count(*) AS n FROM pvp_round_choices').get()?.n).toBe(1);
    expect(sqlite.prepare('SELECT count(*) AS n FROM battle_report_generations').get()?.n).toBe(0);
  });
  it('does not clear large state through a synchronous intervention', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<101) INSERT INTO pvp_room_card_snapshots SELECT 'snapshot'||n,'room',1,'{}','character','test','{}',NULL,'2020-01-01' FROM ids");
    expect(await action('pvp-rooms.restart').execute(db, { id: 'room', expectedVersion: 1, reason: '大房间重开', idempotencyKey: 'large' }, context)).toHaveProperty('status', 'conflict');
    expect(sqlite.prepare('SELECT count(*) AS n FROM pvp_room_card_snapshots').get()?.n).toBe(101);
    expect(sqlite.prepare("SELECT status FROM pvp_matches WHERE id='match'").get()?.status).toBe('active');
  });
  it('forces an overdue submission through shared preset selection without any HTTP or AI dispatch', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("UPDATE pvp_rooms SET phase='submitting'");
    sqlite.exec("INSERT INTO pvp_room_players VALUES('room',1,'player',0,'2020-01-01')");
    const input = { id: 'room', expectedVersion: 1, reason: '最后玩家提交超时', idempotencyKey: 'submission' };
    expect(await action('pvp-rooms.force-submit').execute(db, input, context)).toHaveProperty('status', 'succeeded');
    expect(await action('pvp-rooms.force-submit').execute(db, input, context)).toHaveProperty('replayed', true);
    const row = sqlite.prepare('SELECT submission_json FROM pvp_room_submissions').get();
    const payload = JSON.parse(String(row?.submission_json));
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].ref.kind).toBe('preset');
    expect(payload.hasPrivateCard).toBe(false);
    expect(sqlite.prepare('SELECT count(*) AS n FROM battle_report_generations').get()?.n).toBe(0);
  });
});
