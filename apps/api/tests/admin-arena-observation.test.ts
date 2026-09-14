import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ARENA_OBSERVATION_PATH } from '@mahoshojo/contracts/admin-arena-observation';
import { issueAdminArenaObservationToken } from '@mahoshojo/hosted-runtime/admin/arena-observation';
import { createAdminArenaObservationService, type AdminArenaObservationRedis } from '#/arena-room/admin-observation';
import { registerAdminArenaObservationRoute } from '#/arena-room/admin-observation-http';
import { createArenaRoomRedisKeyspace } from '#/arena-room/redis-room-keyspace';
import { createStoredRoomDirectoryRecord, serializeStoredRoomDirectoryRecord } from '#/arena-room/room-directory-record';
import { readHonoServerConfig } from '#/config';
import type { HonoAppVariables } from '#/middleware/request-metadata';
import { createArenaRoomState, ARENA_ROOM_TEST_TIMESTAMP } from './arena-room-fixtures';

afterEach(() => vi.unstubAllEnvs());
const secret = 'dedicated-admin-observation-test-key-0123456789';
const keyspace = createArenaRoomRedisKeyspace('test');
function fixture() {
  const state = createArenaRoomState('private-room-epoch');
  const values = new Map<string, string>([
    [keyspace.roomDirectoryRecordKey('room-1'), serializeStoredRoomDirectoryRecord(createStoredRoomDirectoryRecord({ roomId: 'room-1', roomEpoch: 'private-room-epoch', hostUserId: 101, title: '房间', visibility: 'unlisted', status: 'open', createdAt: ARENA_ROOM_TEST_TIMESTAMP, lastActivityAt: ARENA_ROOM_TEST_TIMESTAMP }))],
    [keyspace.roomCheckpointKey('room-1'), JSON.stringify({ checkpointVersion: 1, roomId: 'room-1', roomEpoch: 'private-room-epoch', revision: state.snapshot.revision, controlSeq: state.snapshot.controlSeq, state })],
  ]);
  const redis = {
    get: vi.fn<AdminArenaObservationRedis['get']>(async (key) => values.get(key) ?? null),
    pTTL: vi.fn<AdminArenaObservationRedis['pTTL']>(async () => 60_000),
    scan: vi.fn<AdminArenaObservationRedis['scan']>(async () => ({ cursor: '0', keys: [keyspace.roomDirectoryRecordKey('room-1')] })),
  };
  const service = createAdminArenaObservationService(redis, 'test');
  const app = new Hono<{ Variables: HonoAppVariables }>();
  registerAdminArenaObservationRoute(app, { secret, service });
  return { values, redis, service, app };
}
const authorization = async () => `Bearer ${await issueAdminArenaObservationToken(secret, { principalId: 'operator', requestId: 'request' })}`;

describe('Arena internal read-only observation', () => {
  it('projects a credential-free checkpoint summary using only GET/PTTL and leaves storage unchanged', async () => {
    const test = fixture();
    const before = [...test.values.entries()];
    const response = await test.app.request(`${ADMIN_ARENA_OBSERVATION_PATH}?roomId=room-1`, { headers: { Authorization: await authorization() } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ roomId: 'room-1', visibility: 'unlisted', checkpoint: 'present', checkpointRevision: 0, memberCount: 1 });
    expect(JSON.stringify(body)).not.toContain('private-room-epoch');
    expect(JSON.stringify(body)).not.toContain('memberAuthority');
    expect(Object.keys(body.items[0]).sort()).toEqual(['roomId', 'title', 'visibility', 'status', 'hostUserId', 'createdAt', 'lastActivityAt', 'directoryTtlMs', 'checkpoint', 'checkpointRevision', 'memberCount'].sort());
    expect([...test.values.entries()]).toEqual(before);
    expect(test.redis.scan).not.toHaveBeenCalled();
    expect(test.redis.get).toHaveBeenCalledTimes(2);
  });
  it('denies unauthenticated/wrong-secret/mutating requests before touching Redis', async () => {
    const test = fixture();
    expect((await test.app.request(ADMIN_ARENA_OBSERVATION_PATH)).status).toBe(401);
    const wrong = await issueAdminArenaObservationToken(`${secret}other`, { principalId: 'operator', requestId: 'request' });
    expect((await test.app.request(ADMIN_ARENA_OBSERVATION_PATH, { headers: { Authorization: `Bearer ${wrong}` } })).status).toBe(401);
    expect((await test.app.request(ADMIN_ARENA_OBSERVATION_PATH, { method: 'POST', headers: { Authorization: await authorization() } })).status).toBe(405);
    expect(test.redis.get).not.toHaveBeenCalled();
    expect(test.redis.scan).not.toHaveBeenCalled();
  });
  it('keeps nonterminal empty scan pages pageable and never reads checkpoints while listing', async () => {
    const test = fixture();
    test.redis.scan.mockResolvedValueOnce({ cursor: '42', keys: [] });
    expect(await test.service.read({})).toMatchObject({ items: [], nextCursor: '42' });
    const page = await test.service.read({ cursor: '42' });
    expect(page.items[0].checkpoint).toBe('not-read');
    expect(test.redis.scan).toHaveBeenLastCalledWith('42', { MATCH: `${keyspace.directoryRecordPrefix}*`, COUNT: 25, TYPE: 'string' });
    expect(test.redis.get).not.toHaveBeenCalledWith(keyspace.roomCheckpointKey('room-1'));
  });
  it('reports missing/invalid checkpoints without restoring them and uses unavailable for Redis failure', async () => {
    const test = fixture();
    test.values.delete(keyspace.roomCheckpointKey('room-1'));
    expect((await test.service.read({ roomId: 'room-1' })).items[0].checkpoint).toBe('missing');
    test.values.set(keyspace.roomCheckpointKey('room-1'), '{broken');
    expect((await test.service.read({ roomId: 'room-1' })).items[0].checkpoint).toBe('invalid');
    test.redis.get.mockRejectedValueOnce(new Error('private upstream failure'));
    const response = await test.app.request(`${ADMIN_ARENA_OBSERVATION_PATH}?roomId=room-1`, { headers: { Authorization: await authorization() } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private upstream failure');
  });
  it('rejects unsupported and duplicate query fields before access', async () => {
    const test = fixture();
    for (const query of ['roomId=room-1&roomId=room-2', 'roomId=room-1&cursor=42', 'delete=true']) {
      expect((await test.app.request(`${ADMIN_ARENA_OBSERVATION_PATH}?${query}`, { headers: { Authorization: await authorization() } })).status).toBe(400);
    }
    expect(test.redis.get).not.toHaveBeenCalled();
    expect(test.redis.scan).not.toHaveBeenCalled();
  });
  it('requires a separately configured secret and defaults to disabled', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('HOSTED_API_ENVIRONMENT', 'test');
    vi.stubEnv('ADMIN_ARENA_OBSERVATION_SECRET', '');
    expect(readHonoServerConfig().adminArenaObservationSecret).toBeUndefined();
    vi.stubEnv('ADMIN_ARENA_OBSERVATION_SECRET', 'short');
    expect(() => readHonoServerConfig()).toThrow('ADMIN_ARENA_OBSERVATION_SECRET');
    vi.stubEnv('ADMIN_ARENA_OBSERVATION_SECRET', secret);
    vi.stubEnv('SIGNATURE_SECRET_KEY', secret);
    expect(() => readHonoServerConfig()).toThrow('ADMIN_ARENA_OBSERVATION_SECRET');
  });
});
