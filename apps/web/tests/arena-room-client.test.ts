import { describe, expect, it, vi } from 'vitest';

import { createArenaRoomClient } from '@/lib/arena-room/client';
import { hostedDrClientRouting } from '@/config/hosted-routing';

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

const generationMirror = {
  generationRequestId: 'request-12345678',
  generationId: 'generation-1',
  attempt: 1,
  state: 'running' as const,
  configRevision: 0,
  snapshotDigest: 'sha256:generation-snapshot',
  collaborativeInfluence: true,
  participantUserIds: [1],
  startedAt: '2026-08-28T00:01:00.000Z',
};

const generationView = {
  protocolVersion: 1 as const,
  roomId: 'room/1',
  roomEpoch: 'epoch-1',
  generation: generationMirror,
  status: 'running' as const,
  markdown: '权威基线',
  nextChunkSeq: 2,
  finalAuthoritative: false,
};

const generationHistory = {
  protocolVersion: 1 as const,
  roomId: 'room/1',
  roomEpoch: 'epoch-1',
  items: [{
    generationId: 'generation-1',
    state: 'completed' as const,
    configRevision: 0,
    collaborativeInfluence: true,
    startedAt: '2026-08-28T00:01:00.000Z',
    finishedAt: '2026-08-28T00:03:00.000Z',
  }],
};

const generationHistoryView = {
  protocolVersion: 1 as const,
  roomId: 'room/1',
  roomEpoch: 'epoch-1',
  generation: generationHistory.items[0],
  status: 'completed' as const,
  contentStatus: 'available' as const,
  markdown: '# 历史战报',
  result: { version: 1 as const, format: 'stream-markdown' as const, mode: 'classic' as const },
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
      creationRequestId: 'create-request-1234',
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
    expect(new Headers(init?.headers).get('accept')).toBe(
      'application/json; arena-error-taxonomy=2',
    );
    expect(new Headers(init?.headers).has('x-mahoshojo-arena-error-taxonomy')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('create/join 网络结果未知时底层 client 不自动重放', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('connection reset after write');
    });
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.create({
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: snapshot.sharedConfig,
    })).rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('create/join 的畸形成功响应也标记为结果未知', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }, { status: 201 }));
    const client = createArenaRoomClient({
      origin: 'http://127.0.0.1:8787',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.create({
      creationRequestId: 'create-request-1234',
      displayName: '房主',
      directory: { title: '测试房', visibility: 'unlisted' },
      sharedConfig: snapshot.sharedConfig,
    })).rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('create/join 收到 5xx 也保守标记为结果未知', async () => {
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
      creationRequestId: 'create-request-1234',
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

  it('shared Hono primary 同时派生 Room HTTPS 与 WSS endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      protocolVersion: 1,
      ticket: 'signed-ticket',
      expiresInSeconds: 45,
      websocket: {
        path: '/api/arena/rooms/v1/ws',
        protocol: 'mahoshojo.arena-room.v1',
      },
    }));
    const client = createArenaRoomClient({
      origin: hostedDrClientRouting.primaryOrigin,
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    const ticket = await client.issueTicket('room-1', {});
    const [requestUrl] = fetcher.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      `${hostedDrClientRouting.primaryOrigin}/api/arena/rooms/v1/room-1/ticket`,
    );
    const websocketUrl = new URL(client.buildWebSocketUrl(ticket));
    expect(websocketUrl.protocol).toBe('wss:');
    expect(websocketUrl.host).toBe(new URL(hostedDrClientRouting.primaryOrigin).host);
    expect(websocketUrl.pathname).toBe('/api/arena/rooms/v1/ws');
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
      async () => Response.json({ ...generationView, roomId: 'room-other' }),
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

  it('config publish 严格编码 intent，并验证 room/epoch/host self/权威 session', async () => {
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: 0,
      sharedConfig: { ...snapshot.sharedConfig, userGuidance: '显式发布' },
    };
    const published = {
      ...session,
      roomId: 'room/1',
      snapshot: {
        ...snapshot,
        roomId: 'room/1',
        revision: 1,
        sharedConfig: request.sharedConfig,
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(published));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.publishConfig('room/1', request)).resolves.toEqual(published);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/api/arena/rooms/v1/room%2F1/config');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(JSON.parse(String(init?.body))).toEqual(request);

    await expect(client.publishConfig('room/1', {
      ...request,
      payload: { providerApiKey: 'secret-canary' },
    } as never)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('config publish 对 network/5xx/malformed/identity mismatch 均单发并标记 unknown', async () => {
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: 0,
      sharedConfig: { ...snapshot.sharedConfig, userGuidance: '显式发布' },
    };
    const valid = {
      ...session,
      snapshot: { ...snapshot, revision: 1, sharedConfig: request.sharedConfig },
    };
    const member = { ...snapshot.members[0], userId: 'member-1', role: 'member' as const };
    const outcomes: Array<() => Promise<Response>> = [
      async () => { throw new TypeError('connection reset after write'); },
      async () => Response.json({
        code: 'ROOM_UNAVAILABLE',
        error: '房间运行时暂不可用',
      }, { status: 503 }),
      async () => Response.json({ ok: true, malformed: true }),
      async () => Response.json({
        ...valid,
        roomId: 'room-other',
        snapshot: { ...valid.snapshot, roomId: 'room-other' },
      }),
      async () => Response.json({
        ...valid,
        roomEpoch: 'epoch-other',
        snapshot: { ...valid.snapshot, roomEpoch: 'epoch-other' },
      }),
      async () => Response.json({
        ...valid,
        self: member,
        snapshot: { ...valid.snapshot, members: [member] },
      }),
      async () => Response.json({
        ...valid,
        snapshot: { ...valid.snapshot, revision: 2 },
      }),
      async () => Response.json({
        ...valid,
        snapshot: { ...valid.snapshot, sharedConfig: snapshot.sharedConfig },
      }),
    ];

    for (const outcome of outcomes) {
      const fetcher = vi.fn<typeof fetch>(outcome);
      const client = createArenaRoomClient({
        origin: 'https://api.example.test',
        fetch: fetcher,
        getAuthHeader: async () => 'Bearer verified-key',
      });
      await expect(client.publishConfig('room-1', request)).rejects.toMatchObject({
        code: 'ROOM_RESULT_UNKNOWN',
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('generation start 只发送一次完整 transient payload，并严格使用 bearer/omit/encoded URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(generationView, { status: 202 }));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: 0,
      generationRequestId: 'request-12345678',
      sharedConfig: snapshot.sharedConfig,
      hostLocalPayloads: [],
      generation: {
        customProvider: { apiKey: 'test-secret-canary' },
      },
    };

    await expect(client.startGeneration('room/1', request)).resolves.toEqual(generationView);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/api/arena/rooms/v1/room%2F1/generations');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer verified-key');
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('generation start 对 network/5xx/malformed success 均不自动重放并标记 unknown', async () => {
    const request = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: 0,
      generationRequestId: 'request-12345678',
      sharedConfig: snapshot.sharedConfig,
      hostLocalPayloads: [],
      generation: {},
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
        origin: 'https://api.example.test',
        fetch: fetcher,
        getAuthHeader: async () => 'Bearer verified-key',
      });
      await expect(client.startGeneration('room-1', request)).rejects.toMatchObject({
        code: 'ROOM_RESULT_UNKNOWN',
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('generation view 使用纯 GET 严格解析 member-safe projection 与请求 identity', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(generationView));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.getGenerationView('room/1', 'generation-1')).resolves.toEqual(generationView);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.example.test/api/arena/rooms/v1/room%2F1/generations/generation-1',
    );
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit' });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('accept')).toBe(
      'application/json; arena-error-taxonomy=2',
    );
    expect(new Headers(init?.headers).has('x-mahoshojo-arena-error-taxonomy')).toBe(false);

    fetcher.mockResolvedValueOnce(Response.json({
      ...generationView,
      generation: { ...generationMirror, generationId: 'generation-other' },
    }));
    await expect(client.getGenerationView('room/1', 'generation-1')).rejects.toMatchObject({
      code: 'ROOM_RESPONSE_INVALID',
    });
  });

  it('generation history 对 room path 编码并严格验证 room identity', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(generationHistory));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.listGenerationHistory('room/1')).resolves.toEqual(generationHistory);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/arena/rooms/v1/room%2F1/generations',
    );

    const mismatched = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: vi.fn<typeof fetch>(async () => Response.json({ ...generationHistory, roomId: 'other-room' })),
      getAuthHeader: async () => 'Bearer verified-key',
    });
    await expect(mismatched.listGenerationHistory('room/1')).rejects.toMatchObject({
      code: 'ROOM_RESPONSE_INVALID',
    });
  });

  it('generation history detail 使用显式安全视图并校验 generation identity', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(generationHistoryView));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.getGenerationHistoryView('room/1', 'generation-1'))
      .resolves.toEqual(generationHistoryView);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/arena/rooms/v1/room%2F1/generations/generation-1?view=history',
    );

    fetcher.mockResolvedValueOnce(Response.json({
      ...generationHistoryView,
      generation: { ...generationHistoryView.generation, generationId: 'generation-other' },
    }));
    await expect(client.getGenerationHistoryView('room/1', 'generation-1'))
      .rejects.toMatchObject({ code: 'ROOM_RESPONSE_INVALID' });
  });

  it('kick/cancel 只编码 epoch intent 与 path identity，不把客户端权限写入 body', async () => {
    const kickedSession = {
      ...session,
      roomId: 'room/1',
      snapshot: { ...snapshot, roomId: 'room/1' },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(kickedSession))
      .mockResolvedValueOnce(Response.json(generationView));
    const client = createArenaRoomClient({
      origin: 'https://api.example.test',
      fetch: fetcher,
      getAuthHeader: async () => 'Bearer verified-key',
    });

    await expect(client.kick('room/1', 'member/1', 'epoch-1')).resolves.toEqual(kickedSession);
    await expect(client.cancelGeneration('room/1', 'generation-1', 'epoch-1'))
      .resolves.toEqual(generationView);

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/arena/rooms/v1/room%2F1/members/member%2F1/kick',
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      'https://api.example.test/api/arena/rooms/v1/room%2F1/generations/generation-1/cancel',
    );
    for (const [, init] of fetcher.mock.calls) {
      expect(JSON.parse(String(init?.body))).toEqual({ expectedRoomEpoch: 'epoch-1' });
      expect(String(init?.body)).not.toMatch(/role|account|userId|secret|state/iu);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer verified-key');
    }
  });

  it('kick/cancel 对网络、5xx、畸形成功与 identity mismatch 均单发并进入 unknown', async () => {
    const outcomes: Array<() => Promise<Response>> = [
      async () => { throw new TypeError('connection reset after write'); },
      async () => Response.json({ code: 'ROOM_UNAVAILABLE', error: '暂不可用' }, { status: 503 }),
      async () => Response.json({ ok: true }),
      async () => Response.json({ ...generationView, roomId: 'room-other' }),
    ];

    for (const outcome of outcomes) {
      const fetcher = vi.fn<typeof fetch>(outcome);
      const client = createArenaRoomClient({
        origin: 'https://api.example.test',
        fetch: fetcher,
        getAuthHeader: async () => 'Bearer verified-key',
      });
      await expect(client.cancelGeneration('room/1', 'generation-1', 'epoch-1'))
        .rejects.toMatchObject({ code: 'ROOM_RESULT_UNKNOWN' });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
});
