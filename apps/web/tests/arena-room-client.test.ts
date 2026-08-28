import { describe, expect, it, vi } from 'vitest';

import { createArenaRoomClient } from '@/lib/arena-room/client';

const snapshot = {
  protocolVersion: 1,
  schemaVersion: 1,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  revision: 0,
  controlSeq: 0,
  sharedConfig: {
    battleMode: 'classic',
    combatants: [{
      key: 'host-local:character:1',
      displayName: '角色',
      type: 'magical-girl',
      source: 'host-local',
    }],
    teams: [],
    scenario: null,
    auxScenarios: [],
    materials: [],
    userGuidance: '',
    storyLength: 'default',
    customStoryLength: null,
    selectedLanguage: 'zh-CN',
    historySettings: {
      readArenaHistory: true,
      readArenaHistoryLimit: 3,
      isArenaHistoryUnlimited: false,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: true,
      readNarrativeHistory: false,
      readNarrativeHistoryLimit: 10,
      isNarrativeHistoryUnlimited: false,
      writeNarrativeHistory: false,
    },
  },
  members: [{
    userId: 'user-1',
    role: 'host',
    displayName: '房主',
    membershipState: 'active',
  }],
  proposals: [],
  activeGeneration: null,
};

const session = {
  protocolVersion: 1,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  self: snapshot.members[0],
  snapshot,
};

describe('Arena Room browser client', () => {
  it('没有 verified bearer 时不发请求', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => null,
    });

    await expect(client.discover({ limit: 20 })).rejects.toMatchObject({
      code: 'ROOM_AUTHENTICATION_REQUIRED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('create 只发送一次、使用 credentials omit，并严格解析 session', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(session, { status: 201 }));
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });
    const request = {
      displayName: '房主',
      directory: { title: '测试房', visibility: 'public' as const },
      sharedConfig: snapshot.sharedConfig,
    };

    await expect(client.create(request)).resolves.toMatchObject({ roomId: 'room-1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:8787/api/arena/rooms/v1');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer verified-key');
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('非幂等 create/join 网络结果未知时不盲目重放', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('connection reset after write');
    });
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: snapshot.sharedConfig,
    })).rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('非幂等 create/join 的畸形成功响应也标记为结果未知', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }, { status: 201 }));
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: snapshot.sharedConfig,
    })).rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('非幂等 create/join 收到 5xx 也保守标记为结果未知', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      code: 'ROOM_UNAVAILABLE',
      error: '房间运行时暂不可用',
      retryAfterSeconds: 1,
    }, { status: 503 }));
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.create({
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: snapshot.sharedConfig,
    })).rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
  });

  it('leave/close 携带 session epoch fence，身份仍不进入 body', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      protocolVersion: 1,
      roomId: 'room-1',
      outcome: 'left',
    }));
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await client.leave('room-1', 'epoch-1');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      expectedRoomEpoch: 'epoch-1',
    });
  });

  it('ticket 只返回内存值并构造 encoded WSS URL，不写 storage/log', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      protocolVersion: 1,
      ticket: 'signed.ticket?secret',
      expiresInSeconds: 45,
      websocket: {
        path: '/api/arena/rooms/v1/ws',
        protocol: 'mahoshojo.arena-room.v1',
      },
    }));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    const ticket = await client.issueTicket('room-1', {});
    expect(client.buildWebSocketUrl(ticket)).toBe(
      'wss://api.example.test/api/arena/rooms/v1/ws?ticket=signed.ticket%3Fsecret',
    );
  });
});
