import { describe, expect, it, vi } from 'vitest';

import {
  createRedisGenerationReplayStore,
  type RedisGenerationClient,
} from '#/redis/generation-replay-store';

const createClient = (): RedisGenerationClient => ({
  eval: vi.fn(),
  xRead: vi.fn(async () => null),
  get: vi.fn(async () => null),
});

const reserveInput = {
  actorKey: 'user:sensitive-actor-id',
  generationRequestId: 'request-1234',
  generationId: 'generation-1234',
  payloadHash: 'payload-sha256',
  preparationSeed: '22'.repeat(32),
  preparationVersion: 'arena-runtime-v1',
  producerToken: 'producer-token-1234',
  now: '2026-08-25T04:00:00.000Z',
  leaseExpiresAt: '2026-08-25T04:01:00.000Z',
};

describe('RedisGenerationReplayStore', () => {
  it('用单次 Lua reservation 建立 request identity 与 producer ownership，key 不含明文 actor', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue([
      'created',
      'generation-1234',
      reserveInput.preparationSeed,
      reserveInput.preparationVersion,
    ]);
    const store = createRedisGenerationReplayStore({
      getClient: () => client,
      activeTtlSeconds: 3_600,
    });

    await expect(store.reserve(reserveInput)).resolves.toEqual({
      kind: 'created',
      generationId: 'generation-1234',
      preparationSeed: reserveInput.preparationSeed,
      preparationVersion: reserveInput.preparationVersion,
    });

    expect(client.eval).toHaveBeenCalledTimes(1);
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('GEN_RESERVE_V1');
    expect(options.keys).toHaveLength(2);
    expect(options.keys[0]).toMatch(
      /^mahoshojo:gen:v1:req:user:[a-f0-9]{32}:request-1234$/u,
    );
    expect(options.keys[1]).toBe('mahoshojo:gen:v1:generation-1234:state');
    expect(options.keys.join('|')).not.toContain('sensitive-actor-id');
    expect(options.arguments).toContain('3600000');
    expect(options.arguments).toContain(reserveInput.preparationSeed);
    expect(options.arguments).toContain(reserveInput.preparationVersion);
    expect(options.arguments.join('|')).not.toContain('sensitive-actor-id');
  });

  it('共用 Redis 时给 generation replay key 增加环境前缀', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue([
      'created',
      'generation-1234',
      reserveInput.preparationSeed,
      reserveInput.preparationVersion,
    ]);
    const store = createRedisGenerationReplayStore({
      getClient: () => client,
      keyPrefix: 'preview',
    });

    await store.reserve(reserveInput);

    const [, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(options.keys).toEqual([
      expect.stringMatching(/^mahoshojo:gen:v1:preview:req:user:/u),
      'mahoshojo:gen:v1:preview:generation-1234:state',
    ]);
  });

  it.each([
    [[
      'reused',
      'generation-existing',
      reserveInput.preparationSeed,
      reserveInput.preparationVersion,
    ], {
      kind: 'reused',
      generationId: 'generation-existing',
      preparationSeed: reserveInput.preparationSeed,
      preparationVersion: reserveInput.preparationVersion,
    }],
    [[
      'reused',
      'generation-existing',
      '',
      '',
    ], {
      kind: 'reused',
      generationId: 'generation-existing',
      preparationSeed: null,
      preparationVersion: null,
    }],
    [['conflict', ''], { kind: 'conflict' }],
  ] as const)('严格解析 reservation 结果 %j', async (raw, expected) => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(raw);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.reserve(reserveInput)).resolves.toEqual(expected);
  });

  it('rejects incomplete preparation metadata before evaluating Lua', async () => {
    const client = createClient();
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.reserve({
      ...reserveInput,
      preparationVersion: undefined,
    })).rejects.toThrow('REDIS_GENERATION_PREPARATION_INVALID');
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('批量 XADD、容量 trim、state cursor 与 TTL 在同一 Lua 命令中更新', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(['1724570000000-0', '1724570000000-1']);
    const store = createRedisGenerationReplayStore({
      getClient: () => client,
      activeTtlSeconds: 900,
      maxEvents: 512,
    });

    await expect(store.appendEvents({
      generationId: 'generation-1234',
      producerToken: reserveInput.producerToken,
      events: [
        { type: 'markdown', data: { chunk: 'A' } },
        { type: 'reasoning', data: { chunk: 'R' } },
      ],
      now: reserveInput.now,
    })).resolves.toEqual({
      owned: true,
      events: [
        { id: '1724570000000-0', type: 'markdown', data: { chunk: 'A' } },
        { id: '1724570000000-1', type: 'reasoning', data: { chunk: 'R' } },
      ],
    });

    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('GEN_APPEND_V1');
    expect(script).toContain('XTRIM');
    expect(options.keys).toEqual([
      'mahoshojo:gen:v1:generation-1234:state',
      'mahoshojo:gen:v1:generation-1234:events',
    ]);
    expect(options.arguments).toContain('512');
    expect(options.arguments).toContain('900000');
  });

  it('cursor 仍在窗口内时只返回严格晚于 cursor 的独立 subscriber 事件', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce([
      'events',
      JSON.stringify([{ id: '11-0', type: 'markdown', data: '{"chunk":"B"}' }]),
    ]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({
      kind: 'events',
      events: [{ id: '11-0', type: 'markdown', data: { chunk: 'B' } }],
    });

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('GEN_READ_V1'),
      {
        keys: ['mahoshojo:gen:v1:generation-1234:events'],
        arguments: ['10-0', '256'],
      },
    );
    expect(client.xRead).not.toHaveBeenCalled();
  });

  it('cursor 早于已 trim 的首事件时明确返回 window-lost', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce(['window-lost', '[]']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({ kind: 'window-lost', events: [] });

    expect(client.xRead).not.toHaveBeenCalled();
  });

  it('按 event id 精确读取长事件流尾部，不受 replay batch 256 上限影响', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce([
      'event',
      JSON.stringify({
        id: '1724570000000-300',
        type: 'done',
        data: '{"ok":true,"status":"completed"}',
      }),
    ]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readEvent({
      generationId: 'generation-1234',
      eventId: '1724570000000-300',
    })).resolves.toEqual({
      id: '1724570000000-300',
      type: 'done',
      data: { ok: true, status: 'completed' },
    });

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('GEN_READ_EVENT_V1'),
      {
        keys: ['mahoshojo:gen:v1:generation-1234:events'],
        arguments: ['1724570000000-300'],
      },
    );
    expect(client.xRead).not.toHaveBeenCalled();
  });

  it('精确 event 已被 trim 时返回 null', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce(['not-found', '']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readEvent({
      generationId: 'generation-1234',
      eventId: '1724570000000-1',
    })).resolves.toBeNull();
  });

  it('events key 被逐出时明确返回 stream-missing 且不进入 XREAD', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce(['stream-missing', '[]']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({ kind: 'stream-missing', events: [] });
    expect(client.xRead).not.toHaveBeenCalled();
  });

  it('没有立即事件时使用 XREAD tail，不使用 consumer group', async () => {
    const client = createClient();
    vi.mocked(client.eval)
      .mockResolvedValueOnce(['events', '[]'])
      .mockResolvedValueOnce([
        'events',
        JSON.stringify([{ id: '12-0', type: 'done', data: '{"ok":true}' }]),
      ]);
    vi.mocked(client.xRead).mockResolvedValueOnce([{
      name: 'mahoshojo:gen:v1:generation-1234:events',
      messages: [{ id: '12-0', message: { type: 'done', data: '{"ok":true}' } }],
    }]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({
      kind: 'events',
      events: [{ id: '12-0', type: 'done', data: { ok: true } }],
    });
    expect(client.xRead).toHaveBeenCalledWith(
      [{ key: 'mahoshojo:gen:v1:generation-1234:events', id: '10-0' }],
      { BLOCK: 25, COUNT: 256 },
    );
  });

  it('兼容 Redis Lua cjson 将空数组编码为空对象的返回形状', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce(['events', '{}']);
    vi.mocked(client.xRead).mockResolvedValueOnce(null);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({ kind: 'events', events: [] });
  });

  it('XREAD 唤醒后重新校验 cursor，交错 trim 时返回 window-lost 而不跳过事件', async () => {
    const client = createClient();
    vi.mocked(client.eval)
      .mockResolvedValueOnce(['events', '[]'])
      .mockResolvedValueOnce(['window-lost', '[]']);
    vi.mocked(client.xRead).mockResolvedValueOnce([{
      name: 'mahoshojo:gen:v1:generation-1234:events',
      messages: [{ id: '99-0', message: { type: 'markdown', data: '{"chunk":"late"}' } }],
    }]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({ kind: 'window-lost', events: [] });

    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('owner read/cancel 以 actor hash 校验并隐藏他人的 generation', async () => {
    const client = createClient();
    const state = {
      actorKey: 'placeholder',
      generationId: 'generation-1234',
      generationRequestId: 'request-1234',
      payloadHash: 'payload-sha256',
      producerToken: reserveInput.producerToken,
      status: 'running',
      lastEventId: null,
      updatedAt: reserveInput.now,
      leaseExpiresAt: reserveInput.leaseExpiresAt,
      snapshot: null,
      terminal: null,
      cancelRequested: false,
    };
    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      ...state,
      actorHash: 'definitely-not-this-actor',
      reservationKey: 'mahoshojo:gen:v1:req:user:hash:request-1234',
    }));
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readState({
      generationId: 'generation-1234',
      actorKey: reserveInput.actorKey,
    })).resolves.toBeNull();

    vi.mocked(client.eval).mockResolvedValue('forbidden');
    await expect(store.requestCancel({
      generationId: 'generation-1234',
      actorKey: reserveInput.actorKey,
      reason: 'user',
      now: reserveInput.now,
    })).resolves.toEqual({ kind: 'forbidden' });
  });

  it('terminal marker 与可见 terminal event 使用同一 CAS，重复 finalization 不会再次生效', async () => {
    const client = createClient();
    vi.mocked(client.eval)
      .mockResolvedValueOnce([1, '1724570000000-9'])
      .mockResolvedValueOnce(0);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    const input = {
      generationId: 'generation-1234',
      producerToken: reserveInput.producerToken,
      terminal: { status: 'completed' as const, resultRef: 'r2://report/1' },
      terminalEvent: {
        type: 'done',
        data: { status: 'completed', ok: true, resultRef: 'r2://report/1' },
      },
      clearTerminalSnapshot: true as const,
      now: reserveInput.now,
    };

    await expect(store.markTerminal(input)).resolves.toEqual({
      owned: true,
      applied: true,
      event: {
        id: '1724570000000-9',
        type: 'done',
        data: { status: 'completed', ok: true, resultRef: 'r2://report/1' },
      },
    });
    await expect(store.markTerminal(input)).resolves.toEqual({ owned: true, applied: false });
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('GEN_TERMINAL_V2');
    expect(script).toContain('XADD');
    expect(options.keys).toEqual([
      'mahoshojo:gen:v1:generation-1234:state',
      'mahoshojo:gen:v1:generation-1234:events',
    ]);
  });

  it('在执行 Lua 前拒绝 marker-only 或未决定 snapshot 的 terminal mutation', async () => {
    const client = createClient();
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    const unsafe = store as unknown as {
      markTerminal(input: Record<string, unknown>): Promise<unknown>;
    };

    await expect(unsafe.markTerminal({
      generationId: 'generation-1234',
      producerToken: reserveInput.producerToken,
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
      now: reserveInput.now,
    })).rejects.toThrow('REDIS_GENERATION_TERMINAL_EVIDENCE_INVALID');
    await expect(unsafe.markTerminal({
      generationId: 'generation-1234',
      producerToken: reserveInput.producerToken,
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
      terminalEvent: {
        type: 'error',
        data: { ok: false, status: 'failed', code: 'GENERATION_FAILED' },
      },
      now: reserveInput.now,
    })).rejects.toThrow('REDIS_GENERATION_TERMINAL_EVIDENCE_INVALID');
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('terminal snapshot 超预算时在同一 Lua CAS 清除旧 running snapshot', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce([1, '1724570000000-10']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.markTerminal({
      generationId: 'generation-1234',
      producerToken: reserveInput.producerToken,
      terminal: { status: 'failed', code: 'GENERATION_FAILED' },
      terminalEvent: {
        type: 'error',
        data: { ok: false, status: 'failed', code: 'GENERATION_FAILED' },
      },
      clearTerminalSnapshot: true,
      now: reserveInput.now,
    })).resolves.toMatchObject({ owned: true, applied: true });

    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain("ARGV[8] == '1'");
    expect(script).toContain('state.snapshot = cjson.null');
    expect(options.arguments.at(-1)).toBe('1');
  });

  it('只从 Redis 恢复有界的 Provider 安全投影', async () => {
    const client = createClient();
    const terminal = {
      status: 'failed' as const,
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      publicError: {
        code: 'AI_UPSTREAM_REQUEST_FAILED' as const,
        message: 'AI_APICallError: 余额不足（HTTP 402）',
        upstreamStatus: 402,
        upstreamRequestId: 'req-redis-402',
      },
    };
    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      actorHash: 'actor-hash',
      reservationKey: 'reservation-key',
      generationId: 'generation-1234',
      generationRequestId: 'request-1234',
      payloadHash: 'payload-sha256',
      producerToken: reserveInput.producerToken,
      status: 'failed',
      lastEventId: '12-0',
      updatedAt: reserveInput.now,
      leaseExpiresAt: null,
      snapshot: null,
      terminal,
      cancelRequested: false,
    }));
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readState({ generationId: 'generation-1234' })).resolves.toMatchObject({
      terminal,
    });

    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      actorHash: 'actor-hash',
      reservationKey: 'reservation-key',
      generationId: 'generation-1234',
      generationRequestId: 'request-1234',
      payloadHash: 'payload-sha256',
      producerToken: reserveInput.producerToken,
      status: 'failed',
      lastEventId: '12-0',
      updatedAt: reserveInput.now,
      leaseExpiresAt: null,
      snapshot: {
        status: 'running',
        markdown: 'stale partial',
        reasoning: '',
        lastEventId: '11-0',
        updatedAt: reserveInput.now,
      },
      terminal,
      cancelRequested: false,
    }));
    await expect(store.readState({ generationId: 'generation-1234' })).rejects.toThrow(
      'REDIS_GENERATION_STATE_INVALID',
    );

    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      actorHash: 'actor-hash',
      reservationKey: 'reservation-key',
      generationId: 'generation-1234',
      generationRequestId: 'request-1234',
      payloadHash: 'payload-sha256',
      producerToken: reserveInput.producerToken,
      status: 'failed',
      lastEventId: '12-0',
      updatedAt: reserveInput.now,
      leaseExpiresAt: null,
      snapshot: null,
      terminal: {
        ...terminal,
        publicError: { ...terminal.publicError, message: 'X'.repeat(2_001) },
      },
      cancelRequested: false,
    }));
    await expect(store.readState({ generationId: 'generation-1234' })).rejects.toThrow(
      'REDIS_GENERATION_STATE_INVALID',
    );
  });

  it('markRunning 原子观察 reserved cancel，阻止旧 producer 启动 Provider', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('cancelled:content_policy');
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.markRunning({
      generationId: reserveInput.generationId,
      producerToken: reserveInput.producerToken,
      now: reserveInput.now,
      leaseExpiresAt: reserveInput.leaseExpiresAt,
    })).resolves.toEqual({
      owned: true,
      cancelRequested: true,
      cancelReason: 'content_policy',
    });

    expect(vi.mocked(client.eval).mock.calls[0]?.[0]).toContain(
      'state.cancelRequested == true',
    );
    expect(vi.mocked(client.eval).mock.calls[0]?.[0]).toContain('state.cancelReason');
  });

  it('finalization claim returns the stored content-policy cancel reason', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('cancelled:content_policy');
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.claimFinalization({
      generationId: reserveInput.generationId,
      producerToken: reserveInput.producerToken,
      now: reserveInput.now,
      leaseExpiresAt: reserveInput.leaseExpiresAt,
    })).resolves.toEqual({ kind: 'cancelled', cancelReason: 'content_policy' });
  });

  it('requestCancel freezes and returns the actual allowlisted reason', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('accepted:content_policy');
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.requestCancel({
      generationId: reserveInput.generationId,
      actorKey: reserveInput.actorKey,
      reason: 'content_policy',
      now: reserveInput.now,
    })).resolves.toEqual({ kind: 'accepted', cancelReason: 'content_policy' });
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('state.cancelRequested == true');
    expect(script).toContain("return 'accepted:' .. state.cancelReason");
    expect(options.arguments[1]).toBe('content_policy');
  });

  it.each(['claimed', 'cancelled', 'fenced'] as const)(
    'finalization claim 只通过 Redis producer CAS 返回 %s',
    async (kind) => {
      const client = createClient();
      vi.mocked(client.eval).mockResolvedValue(kind);
      const store = createRedisGenerationReplayStore({ getClient: () => client });

      await expect(store.claimFinalization({
        generationId: reserveInput.generationId,
        producerToken: reserveInput.producerToken,
        now: reserveInput.now,
        leaseExpiresAt: reserveInput.leaseExpiresAt,
      })).resolves.toEqual(kind === 'cancelled'
        ? { kind, cancelReason: 'user' }
        : { kind });
      expect(vi.mocked(client.eval).mock.calls[0]?.[0]).toContain(
        'GEN_CLAIM_FINALIZATION_V1',
      );
    },
  );

  it('expired lease reaper CAS rotates producer ownership before durable terminal write', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue([
      'claimed',
      reserveInput.generationRequestId,
      reserveInput.payloadHash,
      'scenario',
    ]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.claimLeaseExpiry({
      generationId: reserveInput.generationId,
      actorKey: reserveInput.actorKey,
      reaperToken: 'reaper-token-1',
      now: '2026-08-25T04:02:00.000Z',
      leaseExpiresAt: '2026-08-25T04:03:00.000Z',
    })).resolves.toEqual({
      kind: 'claimed',
      generationRequestId: reserveInput.generationRequestId,
      payloadHash: reserveInput.payloadHash,
      mode: 'scenario',
    });
    expect(vi.mocked(client.eval).mock.calls[0]?.[0]).toContain('GEN_CLAIM_LEASE_EXPIRY_V1');
  });

  it('releases only the still-reserved producer-owned reservation', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(1);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.releaseReservation({
      generationId: reserveInput.generationId,
      producerToken: reserveInput.producerToken,
    })).resolves.toEqual({ released: true });
    expect(vi.mocked(client.eval).mock.calls[0]?.[0]).toContain(
      'GEN_RELEASE_RESERVATION_V1',
    );
  });
});
