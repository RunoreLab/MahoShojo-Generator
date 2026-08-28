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

  it('Proposal 三类 mutation 严格编码 intent，结果未知时每次只发送一次', async () => {
    const response = {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 4,
      revision: 0,
      proposalId: 'proposal/1',
      status: 'submitted',
      result: 'applied',
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(response));
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });
    const submitIntent = {
      proposalId: 'proposal/1',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 0,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance' as const,
        value: '成员建议',
        expectedBase: { kind: 'value' as const, value: '' },
      }],
    };

    await expect(client.submitProposal('room/1', submitIntent)).resolves.toEqual(response);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://127.0.0.1:8787/api/arena/rooms/v1/room%2F1/proposals',
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(submitIntent);

    fetcher.mockResolvedValueOnce(Response.json({
      ...response,
      status: 'accepted',
      revision: 1,
    }));
    await client.resolveProposal('room/1', 'proposal/1', {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      'http://127.0.0.1:8787/api/arena/rooms/v1/room%2F1/proposals/proposal%2F1/resolve',
    );

    fetcher.mockRejectedValueOnce(new TypeError('reset after write'));
    await expect(client.withdrawProposal('room-1', 'proposal-1', 'epoch-1'))
      .rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('Proposal network/5xx/malformed success 均不重放并统一进入 unknown', async () => {
    const intent = {
      proposalId: 'proposal-unknown-matrix',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 0,
      changes: [{
        changeId: 'guidance-1',
        type: 'setUserGuidance' as const,
        value: '成员建议',
        expectedBase: { kind: 'value' as const, value: '' },
      }],
    };
    const outcomes: Array<() => Promise<Response>> = [
      async () => { throw new TypeError('connection reset after write'); },
      async () => Response.json({
        code: 'ROOM_UNAVAILABLE',
        error: '房间运行时暂不可用',
      }, { status: 503 }),
      async () => Response.json({ ok: true, malformed: true }),
    ];

    for (const outcome of outcomes) {
      const fetcher = vi.fn<typeof fetch>(outcome);
      const client = createArenaRoomClient({
        origin: 'http://127.0.0.1:8787',
        fetch: fetcher,
        getAuthHeader: async () => 'Bearer verified-key',
      });
      await expect(client.submitProposal('room-1', intent)).rejects.toMatchObject({
        code: 'ROOM_RESULT_UNKNOWN',
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
});
