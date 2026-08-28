import type { D1LikeStatementResult } from '@mahoshojo/hosted-runtime/d1-http-client';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { describe, expect, it, vi } from 'vitest';

import {
  createD1RoomDirectoryStore,
  RoomDirectoryStoreError,
} from '#/arena-room/d1-room-directory-store';

type StatementCall = {
  sql: string;
  params: unknown[];
  mode: 'all' | 'run';
  options: unknown;
};

const success = (results: Record<string, unknown>[] = []): D1LikeStatementResult => ({
  success: true,
  results,
  meta: {},
});

const createClient = (
  responder: (call: StatementCall) => D1LikeStatementResult = () => success(),
): { client: NodeDataD1Client; calls: StatementCall[] } => {
  const calls: StatementCall[] = [];
  const client: NodeDataD1Client = {
    prepare(sql) {
      let params: unknown[] = [];
      const statement: NodeDataD1Statement = {
        bind(...input) {
          params = input;
          return statement;
        },
        async all(options) {
          const call = { sql, params, mode: 'all' as const, options };
          calls.push(call);
          return responder(call);
        },
        async run(options) {
          const call = { sql, params, mode: 'run' as const, options };
          calls.push(call);
          return responder(call);
        },
      };
      return statement;
    },
  };
  return { client, calls };
};

const openRecord = {
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  hostUserId: 101,
  title: '协作竞技场',
  visibility: 'public' as const,
  status: 'open' as const,
  createdAt: '2026-08-28T08:00:00.000Z',
  lastActivityAt: '2026-08-28T08:10:00.000Z',
};

const databaseRow = {
  id: openRecord.roomId,
  room_epoch: openRecord.roomEpoch,
  host_user_id: openRecord.hostUserId,
  title: openRecord.title,
  visibility: openRecord.visibility,
  status: openRecord.status,
  created_at: openRecord.createdAt,
  last_activity_at: openRecord.lastActivityAt,
};

describe('D1 Room directory store', () => {
  it('open upsert 使用 epoch/activity 单调 fence，写入不盲目重放', async () => {
    const { client, calls } = createClient();
    const store = createD1RoomDirectoryStore({ getClient: () => client });

    await expect(store.upsertOpen(openRecord)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      mode: 'run',
      options: { retry: 'none' },
      params: [
        'room-1',
        'epoch-1',
        101,
        '协作竞技场',
        'public',
        '2026-08-28T08:00:00.000Z',
        '2026-08-28T08:10:00.000Z',
      ],
    });
    expect(calls[0]?.sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(calls[0]?.sql).toContain('excluded.last_activity_at > arena_multiplayer_rooms.last_activity_at');
    expect(calls[0]?.sql).toContain('excluded.room_epoch = arena_multiplayer_rooms.room_epoch');
  });

  it('delete 绑定 exact roomEpoch 且幂等写不启用 transport retry', async () => {
    const { client, calls } = createClient();
    const store = createD1RoomDirectoryStore({ getClient: () => client });

    await store.delete({ roomId: 'room-1', roomEpoch: 'epoch-1' });
    await store.delete({ roomId: 'room-1', roomEpoch: 'epoch-1' });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({
        mode: 'run',
        options: { retry: 'none' },
        params: ['room-1', 'epoch-1'],
      });
      expect(call.sql).toContain('WHERE id = ? AND room_epoch = ?');
    }
  });

  it('public/host/reconciliation 查询均 cursor-bounded、稳定排序且只安全重放读', async () => {
    const { client, calls } = createClient(() => success([databaseRow]));
    const store = createD1RoomDirectoryStore({ getClient: () => client });
    const after = {
      lastActivityAt: '2026-08-28T08:20:00.000Z',
      roomId: 'room-cursor',
    };

    await expect(store.listPublic({ after, limit: 21 })).resolves.toEqual([openRecord]);
    await expect(store.listByHost({ hostUserId: 101, after, limit: 21 }))
      .resolves.toEqual([openRecord]);
    await expect(store.listReconciliationCandidates({
      inactiveBefore: '2026-08-28T09:00:00.000Z',
      after,
      limit: 50,
    })).resolves.toEqual([openRecord]);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.sql).toContain("visibility = 'public' AND status = 'open'");
    expect(calls[1]?.sql).toContain("host_user_id = ? AND status = 'open'");
    expect(calls[2]?.sql).toContain("status = 'open' AND last_activity_at <= ?");
    for (const call of calls) {
      expect(call.mode).toBe('all');
      expect(call.options).toEqual({ retry: 'safe-read' });
      expect(call.sql).toContain('last_activity_at < ?');
      expect(call.sql).toContain('ORDER BY last_activity_at DESC, id DESC');
      expect(call.sql).toContain('LIMIT ?');
    }
  });

  it('get 支持 public/unlisted exact lookup，但 malformed D1 row fail closed', async () => {
    const responder = vi.fn<(call: StatementCall) => D1LikeStatementResult>()
      .mockReturnValueOnce(success([{ ...databaseRow, visibility: 'unlisted' }]))
      .mockReturnValueOnce(success([{ ...databaseRow, room_epoch: null }]));
    const { client, calls } = createClient(responder);
    const store = createD1RoomDirectoryStore({ getClient: () => client });

    await expect(store.get('room-1')).resolves.toMatchObject({ visibility: 'unlisted' });
    await expect(store.get('room-1')).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_ROW_INVALID',
    });
    expect(calls.every((call) => call.options && (
      call.options as { retry?: string }
    ).retry === 'safe-read')).toBe(true);
  });

  it('client 缺失、失败 envelope 与越界输入均显式 fail closed', async () => {
    const unavailable = createD1RoomDirectoryStore({ getClient: () => null });
    await expect(unavailable.get('room-1')).rejects.toBeInstanceOf(RoomDirectoryStoreError);
    await expect(unavailable.get('room-1')).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_UNAVAILABLE',
    });

    const failedClient = createClient(() => ({ success: false, results: [], meta: {} }));
    const failed = createD1RoomDirectoryStore({ getClient: () => failedClient.client });
    await expect(failed.upsertOpen(openRecord)).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_D1_FAILED',
    });
    await expect(failed.listPublic({ limit: 52 })).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_INPUT_INVALID',
    });
    await expect(failed.upsertOpen({ ...openRecord, title: ' ' })).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_INPUT_INVALID',
    });
  });
});
