import { describe, expect, it, vi } from 'vitest';

import {
  createRedisRoomDirectoryStore,
  type RedisRoomDirectoryClient,
} from '#/arena-room/redis-room-directory-store';
import {
  createStoredRoomDirectoryRecord,
  roomDirectoryPublicIndexMember,
  serializeStoredRoomDirectoryRecord,
} from '#/arena-room/room-directory-record';

const record = (roomId = 'room-1') => createStoredRoomDirectoryRecord({
  roomId,
  roomEpoch: 'epoch-1',
  hostUserId: 101,
  title: '公开测试房',
  visibility: 'public',
  status: 'open',
  createdAt: '2026-08-28T00:00:00.000Z',
  lastActivityAt: '2026-08-28T00:01:00.000Z',
});

const client = (): RedisRoomDirectoryClient => ({
  eval: vi.fn(),
  get: vi.fn(async () => null),
});

describe('RedisRoomDirectoryStore', () => {
  it('使用环境隔离的定长 hash record key，并以有界 lex cursor 查询 public index', async () => {
    const redis = client();
    const first = record('room-1');
    const second = record('room-2');
    vi.mocked(redis.eval).mockResolvedValue(JSON.stringify([
      { indexMember: first.publicIndexMember, raw: serializeStoredRoomDirectoryRecord(first) },
      { indexMember: second.publicIndexMember, raw: serializeStoredRoomDirectoryRecord(second) },
    ]));
    const store = createRedisRoomDirectoryStore({
      getClient: () => redis,
      keyPrefix: 'preview',
    });

    const candidates = await store.listPublicCandidates({
      afterIndexMember: roomDirectoryPublicIndexMember(
        'room-cursor',
        '2026-08-28T00:02:00.000Z',
      ),
      limit: 2,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      indexMember: first.publicIndexMember,
      raw: serializeStoredRoomDirectoryRecord(first),
      recordKey: expect.stringMatching(
        /^mahoshojo:room-directory:v1:preview:entry:[a-f0-9]{64}$/u,
      ),
    });
    const [script, options] = vi.mocked(redis.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_DIRECTORY_PUBLIC_LIST_V1');
    expect(script).toContain("'ZRANGE'");
    expect(script).toContain("'BYLEX'");
    expect(script).toContain("'LIMIT'");
    expect(options.keys).toEqual(['mahoshojo:room-directory:v1:preview:public']);
    expect(options.arguments[0]).toMatch(/^\(/u);
    expect(options.arguments[1]).toBe('2');
    expect(options.arguments[2]).toBe('mahoshojo:room-directory:v1:preview:entry:');
  });

  it('missing record candidate 仍推进 cursor，并由同一 Lua 原子 lazy ZREM', async () => {
    const redis = client();
    const member = roomDirectoryPublicIndexMember('room-missing', '2026-08-28T00:00:00.000Z');
    vi.mocked(redis.eval).mockResolvedValue(JSON.stringify([
      { indexMember: member, raw: null },
    ]));
    const store = createRedisRoomDirectoryStore({ getClient: () => redis });

    await expect(store.listPublicCandidates({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ indexMember: member, raw: null }),
    ]);
    const [script] = vi.mocked(redis.eval).mock.calls[0]!;
    expect(script).toContain("redis.call('ZREM', KEYS[1], member)");
  });

  it('空 sorted set 显式返回 JSON array，避免 Redis cjson 把空 table 编码为 object', async () => {
    const redis = client();
    vi.mocked(redis.eval).mockResolvedValue('[]');
    const store = createRedisRoomDirectoryStore({ getClient: () => redis });

    await expect(store.listPublicCandidates({ limit: 1 })).resolves.toEqual([]);
    const [script] = vi.mocked(redis.eval).mock.calls[0]!;
    expect(script).toContain("if #result == 0 then return '[]' end");
  });

  it('exact raw cleanup 不会删除并发 replacement record/index', async () => {
    const redis = client();
    const stored = record();
    const raw = serializeStoredRoomDirectoryRecord(stored);
    vi.mocked(redis.eval)
      .mockResolvedValueOnce('removed')
      .mockResolvedValueOnce('stale');
    const store = createRedisRoomDirectoryStore({ getClient: () => redis });
    const loaded = await store.candidateFromRaw({
      roomId: stored.roomId,
      raw,
      indexMember: stored.publicIndexMember,
    });

    await expect(store.removeIfExact(loaded)).resolves.toEqual({ kind: 'removed' });
    await expect(store.removeIfExact(loaded)).resolves.toEqual({ kind: 'stale' });
    const [script, options] = vi.mocked(redis.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_DIRECTORY_REMOVE_EXACT_V1');
    expect(script).toContain("indexType ~= 'zset'");
    expect(script).toContain('raw ~= ARGV[1]');
    expect(script.indexOf('raw ~= ARGV[1]'))
      .toBeLessThan(script.indexOf("redis.call('DEL', KEYS[1])"));
    expect(options.arguments).toEqual([raw, stored.publicIndexMember]);
    expect(options.keys[0]).toMatch(/:entry:[a-f0-9]{64}$/u);
    expect(options.keys[1]).toBe('mahoshojo:room-directory:v1:public');
  });

  it('拒绝 Redis 返回的越界、非法 member 或伪 record 响应', async () => {
    const redis = client();
    const store = createRedisRoomDirectoryStore({ getClient: () => redis });

    await expect(store.listPublicCandidates({ limit: 52 }))
      .rejects.toThrow('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
    expect(redis.eval).not.toHaveBeenCalled();

    vi.mocked(redis.eval).mockResolvedValue(JSON.stringify([
      { indexMember: 'attacker-controlled', raw: '{}' },
    ]));
    await expect(store.listPublicCandidates({ limit: 1 }))
      .rejects.toThrow('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
  });
});
