import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  createRedisGenerationReplayStore,
  type RedisGenerationClient,
} from '#/redis/generation-replay-store';

const identityKey = 'mahoshojo:gen:v1:req:user:hash:request-1234';
// Legacy operation fixtures supply only their response; eval still records every
// discovery/read command, tested explicitly alongside the operation contracts.
const createClient = () => {
  const command = vi.fn<RedisGenerationClient['eval']>();
  const get = vi.fn<RedisGenerationClient['get']>(async () => null);
  const evalCommand = vi.fn<RedisGenerationClient['eval']>(async (script, options) => {
    if (script.includes('GEN_DISCOVER_IDENTITY')) return identityKey;
    if (script.includes('GEN_READ_STATE')) return [await get(options.keys[0]!), ''];
    return command(script, options);
  });
  return { eval: evalCommand, command, get, xRead: vi.fn<RedisGenerationClient['xRead']>(async () => null) };
};

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
  it('binds full SHA-256 producer digests and rejects the truncated key-hash form', async () => {
    const client = createClient();
    client.command.mockResolvedValue(['created', reserveInput.generationId, '22'.repeat(32), 'arena-runtime-v1']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    const digest = createHash('sha256').update(reserveInput.producerToken).digest('hex');
    const input = { ...reserveInput, actorKey: 'pvp-room:room-1', producerTokenDigest: `sha256:${digest}`,
      roomAdmission: {
        version: 'room-generation-start-gate-v1' as const, roomId: 'room-1', roomEpoch: 'epoch-1',
        hostUserId: 'host-1', hostAccountUserId: 42, generationId: reserveInput.generationId,
        generationRequestId: reserveInput.generationRequestId, attempt: 1 as const, configRevision: 0,
        snapshotDigest: `sha256:${'a'.repeat(64)}`, generationPayloadDigest: `sha256:${'b'.repeat(64)}`,
        mode: 'classic', startedAt: reserveInput.now,
      },
    };
    await expect(store.reserve(input)).resolves.toMatchObject({ kind: 'created' });
    expect(client.command).toHaveBeenCalledOnce();
    await expect(store.reserve({ ...input, producerTokenDigest: `sha256:${digest.slice(0, 32)}` })).rejects.toThrow();
    expect(client.command).toHaveBeenCalledOnce();
  });

  it('用单次 Lua reservation 建立 request identity 与 producer ownership，key 不含明文 actor', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue([
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

    expect(client.command).toHaveBeenCalledTimes(1);
    const [script, options] = vi.mocked(client.command).mock.calls[0]!;
    expect(script).toContain('GEN_RESERVE_V1');
    expect(options.keys).toHaveLength(3);
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
    vi.mocked(client.command).mockResolvedValue([
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

    const [, options] = vi.mocked(client.command).mock.calls[0]!;
    expect(options.keys).toEqual([
      expect.stringMatching(/^mahoshojo:gen:v1:preview:req:user:/u),
      'mahoshojo:gen:v1:preview:generation-1234:state',
      'mahoshojo:gen:v1:preview:generation-1234:snapshot',
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
    vi.mocked(client.command).mockResolvedValue(raw);
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
    expect(client.command).not.toHaveBeenCalled();
  });

  it('批量 XADD、容量 trim、state cursor 与 TTL 在同一 Lua 命令中更新', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue(['1724570000000-0', '1724570000000-1']);
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

    const [script, options] = vi.mocked(client.command).mock.calls[0]!;
    expect(script).toContain('GEN_APPEND_V1');
    expect(script).toContain('XTRIM');
    expect(options.keys).toEqual([
      'mahoshojo:gen:v1:generation-1234:state',
      'mahoshojo:gen:v1:generation-1234:events',
      identityKey,
      'mahoshojo:gen:v1:generation-1234:snapshot',
    ]);
    expect(options.arguments).toContain('512');
    expect(options.arguments).toContain('900000');
  });

  it('将 event.data 预序列化后透传给 XADD，不经过 Lua cjson 重编码', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue(['1724570000000-0']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await store.appendEvents({
      generationId: 'generation-1234',
      producerToken: reserveInput.producerToken,
      events: [{
        type: 'ranking',
        data: {
          success: true,
          generationId: 'generation-1234',
          state: 'ready',
          participants: [],
        },
      }],
      now: reserveInput.now,
    });

    const [script, options] = vi.mocked(client.command).mock.calls[0]!;
    expect(script).toContain("'data', event.dataJson");
    expect(script).not.toContain('cjson.encode(event.data)');
    expect(JSON.parse(options.arguments[1]!)).toEqual([{
      type: 'ranking',
      dataJson: JSON.stringify({
        success: true,
        generationId: 'generation-1234',
        state: 'ready',
        participants: [],
      }),
    }]);
  });

  it('cursor 仍在窗口内时只返回严格晚于 cursor 的独立 subscriber 事件', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValueOnce([
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

    expect(client.command).toHaveBeenCalledWith(
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
    vi.mocked(client.command).mockResolvedValueOnce(['window-lost', '[]']);
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
    vi.mocked(client.command).mockResolvedValueOnce([
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

    expect(client.command).toHaveBeenCalledWith(
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
    vi.mocked(client.command).mockResolvedValueOnce(['not-found', '']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readEvent({
      generationId: 'generation-1234',
      eventId: '1724570000000-1',
    })).resolves.toBeNull();
  });

  it('events key 被逐出时明确返回 stream-missing 且不进入 XREAD', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValueOnce(['stream-missing', '[]']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs: 25,
    })).resolves.toEqual({ kind: 'stream-missing', events: [] });
    expect(client.xRead).not.toHaveBeenCalled();
  });

  it('首个 event 前 stream 尚未创建时用 XREAD 等待首次 XADD 唤醒', async () => {
    const client = createClient();
    vi.mocked(client.command)
      .mockResolvedValueOnce(['stream-missing', '[]'])
      .mockResolvedValueOnce([
        'events',
        JSON.stringify([{ id: '1-0', type: 'markdown', data: '{"chunk":"A"}' }]),
      ]);
    vi.mocked(client.xRead).mockResolvedValueOnce([{
      name: 'mahoshojo:gen:v1:generation-1234:events',
      messages: [{ id: '1-0', message: { type: 'markdown', data: '{"chunk":"A"}' } }],
    }]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: null,
      blockMs: 1_000,
    })).resolves.toEqual({
      kind: 'events',
      events: [{ id: '1-0', type: 'markdown', data: { chunk: 'A' } }],
    });
    expect(client.xRead).toHaveBeenCalledWith(
      [{ key: 'mahoshojo:gen:v1:generation-1234:events', id: '0-0' }],
      { BLOCK: 1_000, COUNT: 256 },
    );
  });

  it('没有立即事件时使用 XREAD tail，不使用 consumer group', async () => {
    const client = createClient();
    vi.mocked(client.command)
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

  it.each([
    { blockMs: 0, expectedBlockMs: 1 },
    { blockMs: 10_000, expectedBlockMs: 1_000 },
    { blockMs: Number.NaN, expectedBlockMs: 1_000 },
  ])('将 XREAD BLOCK $blockMs 规范到安全范围', async ({ blockMs, expectedBlockMs }) => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValueOnce(['events', '[]']);
    vi.mocked(client.xRead).mockResolvedValueOnce(null);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readAfter({
      generationId: 'generation-1234',
      after: '10-0',
      blockMs,
    })).resolves.toEqual({ kind: 'events', events: [] });

    expect(client.xRead).toHaveBeenCalledWith(
      [{ key: 'mahoshojo:gen:v1:generation-1234:events', id: '10-0' }],
      { BLOCK: expectedBlockMs, COUNT: 256 },
    );
  });

  it('兼容 Redis Lua cjson 将空数组编码为空对象的返回形状', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValueOnce(['events', '{}']);
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
    vi.mocked(client.command)
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

    expect(client.command).toHaveBeenCalledTimes(2);
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

    vi.mocked(client.command).mockResolvedValue('forbidden');
    await expect(store.requestCancel({
      generationId: 'generation-1234',
      actorKey: reserveInput.actorKey,
      reason: 'user',
      now: reserveInput.now,
    })).resolves.toEqual({ kind: 'forbidden' });
  });

  it('terminal marker 与可见 terminal event 使用同一 CAS，重复 finalization 不会再次生效', async () => {
    const client = createClient();
    vi.mocked(client.command)
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
    const [script, options] = vi.mocked(client.command).mock.calls[0]!;
    expect(script).toContain('GEN_TERMINAL_V2');
    expect(script).toContain('XADD');
    expect(options.keys).toEqual([
      'mahoshojo:gen:v1:generation-1234:state',
      'mahoshojo:gen:v1:generation-1234:events',
      identityKey,
      'mahoshojo:gen:v1:generation-1234:snapshot',
    ]);
    expect(script).toContain("'data', terminalEvent.dataJson");
    expect(script).not.toContain('cjson.encode(terminalEvent.data)');
    expect(JSON.parse(options.arguments[5]!)).toEqual({
      type: 'done',
      dataJson: JSON.stringify({ status: 'completed', ok: true, resultRef: 'r2://report/1' }),
    });
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
    expect(client.command).not.toHaveBeenCalled();
  });

  it('terminal snapshot 超预算时在同一 Lua CAS 清除旧 running snapshot', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValueOnce([1, '1724570000000-10']);
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

    const [script, options] = vi.mocked(client.command).mock.calls[0]!;
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
      reservationKey: identityKey,
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
      reservationKey: identityKey,
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
      reservationKey: identityKey,
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

  it('从 Redis 恢复 completed 未归档告警而不改判失败', async () => {
    const client = createClient();
    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      actorHash: 'actor-hash',
      reservationKey: identityKey,
      generationId: 'generation-1234',
      generationRequestId: 'request-1234',
      payloadHash: 'payload-sha256',
      producerToken: reserveInput.producerToken,
      status: 'completed',
      lastEventId: '12-0',
      updatedAt: reserveInput.now,
      leaseExpiresAt: null,
      snapshot: {
        status: 'completed',
        markdown: '本次连接内仍可读取的完整正文',
        reasoning: '',
        lastEventId: '12-0',
        updatedAt: reserveInput.now,
        terminalResultRef: null,
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      },
      terminal: {
        status: 'completed',
        resultRef: null,
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      },
      cancelRequested: false,
    }));
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.readState({ generationId: 'generation-1234' })).resolves.toMatchObject({
      status: 'completed',
      snapshot: {
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      },
      terminal: {
        status: 'completed',
        persistenceWarning: 'OUTPUT_NOT_ARCHIVED',
      },
    });
  });

  it('markRunning 原子观察 reserved cancel，阻止旧 producer 启动 Provider', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue('cancelled:content_policy');
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

    expect(vi.mocked(client.command).mock.calls[0]?.[0]).toContain(
      'state.cancelRequested == true',
    );
    expect(vi.mocked(client.command).mock.calls[0]?.[0]).toContain('state.cancelReason');
  });

  it('finalization claim returns the stored content-policy cancel reason', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue('cancelled:content_policy');
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
    vi.mocked(client.command).mockResolvedValue('accepted:content_policy');
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.requestCancel({
      generationId: reserveInput.generationId,
      actorKey: reserveInput.actorKey,
      reason: 'content_policy',
      now: reserveInput.now,
    })).resolves.toEqual({ kind: 'accepted', cancelReason: 'content_policy' });
    const [script, options] = vi.mocked(client.command).mock.calls[0]!;
    expect(script).toContain('state.cancelRequested == true');
    expect(script).toContain("or ('accepted:' .. state.cancelReason)");
    expect(options.arguments[1]).toBe('content_policy');
  });

  it.each(['claimed', 'cancelled', 'fenced'] as const)(
    'finalization claim 只通过 Redis producer CAS 返回 %s',
    async (kind) => {
      const client = createClient();
      vi.mocked(client.command).mockResolvedValue(kind);
      const store = createRedisGenerationReplayStore({ getClient: () => client });

      await expect(store.claimFinalization({
        generationId: reserveInput.generationId,
        producerToken: reserveInput.producerToken,
        now: reserveInput.now,
        leaseExpiresAt: reserveInput.leaseExpiresAt,
      })).resolves.toEqual(kind === 'cancelled'
        ? { kind, cancelReason: 'user' }
        : { kind });
      expect(vi.mocked(client.command).mock.calls[0]?.[0]).toContain(
        'GEN_CLAIM_FINALIZATION_V1',
      );
    },
  );

  it('persists completed intent in finalization CAS and returns it to the lease reaper', async () => {
    const client = createClient();
    vi.mocked(client.command)
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce([
        'claimed',
        reserveInput.generationRequestId,
        reserveInput.payloadHash,
        'classic',
        JSON.stringify({ status: 'completed' }),
      ]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await store.claimFinalization({
      generationId: reserveInput.generationId,
      producerToken: reserveInput.producerToken,
      now: reserveInput.now,
      leaseExpiresAt: reserveInput.leaseExpiresAt,
      terminal: { status: 'completed' },
    });
    await expect(store.claimLeaseExpiry({
      generationId: reserveInput.generationId,
      actorKey: reserveInput.actorKey,
      reaperToken: 'reaper-token-1',
      now: '2026-08-25T04:02:00.000Z',
      leaseExpiresAt: '2026-08-25T04:03:00.000Z',
    })).resolves.toMatchObject({
      kind: 'claimed',
      intendedTerminal: { status: 'completed' },
    });

    const [claimScript, claimOptions] = vi.mocked(client.command).mock.calls[0]!;
    expect(claimScript).toContain('state.intendedTerminal');
    expect(claimOptions.arguments).toContain(JSON.stringify({ status: 'completed' }));
    const [reaperScript] = vi.mocked(client.command).mock.calls[1]!;
    expect(reaperScript).toContain('state.intendedTerminal');
  });

  it('expired lease reaper CAS rotates producer ownership before durable terminal write', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue([
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
    expect(vi.mocked(client.command).mock.calls[0]?.[0]).toContain('GEN_CLAIM_LEASE_EXPIRY_V1');
  });

  it('releases only the still-reserved producer-owned reservation', async () => {
    const client = createClient();
    vi.mocked(client.command).mockResolvedValue(1);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.releaseReservation({
      generationId: reserveInput.generationId,
      producerToken: reserveInput.producerToken,
    })).resolves.toEqual({ released: true });
    expect(vi.mocked(client.command).mock.calls[0]?.[0]).toContain(
      'GEN_RELEASE_RESERVATION_V1',
    );
  });
});

describe('Redis replay layout compatibility', () => {
  const snapshot = {
    status: 'running', markdown: '正文✨', reasoning: 'reasoning', lastEventId: '12-0',
    updatedAt: reserveInput.now, telemetry: null, terminalResultRef: null,
  };
  const sidecar = JSON.stringify(snapshot);
  const state = {
    actorHash: 'actor-hash', reservationKey: identityKey,
    generationId: reserveInput.generationId, generationRequestId: reserveInput.generationRequestId,
    payloadHash: reserveInput.payloadHash, producerToken: reserveInput.producerToken,
    status: 'running', lastEventId: '12-0', updatedAt: reserveInput.now,
    leaseExpiresAt: reserveInput.leaseExpiresAt, snapshot: null, terminal: null,
    cancelRequested: false, storageVersion: 2,
    snapshotMeta: {
      status: snapshot.status, lastEventId: snapshot.lastEventId, updatedAt: snapshot.updatedAt,
      digest: createHash('sha1').update(sidecar).digest('hex'),
    },
  };

  it.each([undefined, false, true])('only opt-in reservations create sidecars: %s', async (enabled) => {
    const client = createClient();
    client.command.mockResolvedValue(['created', reserveInput.generationId, '', '']);
    const store = createRedisGenerationReplayStore({ getClient: () => client, enableSnapshotSidecar: enabled });
    await store.reserve(reserveInput);
    const [, command] = client.eval.mock.calls[0]!;
    expect(JSON.parse(command.arguments[3]!)).toMatchObject(enabled
      ? { storageVersion: 2, snapshotMeta: null, snapshot: null }
      : { snapshot: null });
    if (!enabled) expect(JSON.parse(command.arguments[3]!)).not.toHaveProperty('storageVersion');
    expect(command.keys[2]).toBe('mahoshojo:gen:v1:generation-1234:snapshot');
  });

  it('atomically reads raw state and sidecar with the creation flag disabled', async () => {
    const client = createClient();
    client.eval.mockResolvedValue([JSON.stringify(state), sidecar]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    await expect(store.readState({ generationId: reserveInput.generationId })).resolves.toMatchObject({ snapshot });
    await expect(store.readSnapshot({ generationId: reserveInput.generationId })).resolves.toEqual(snapshot);
    expect(client.get).not.toHaveBeenCalled();
    const [script, command] = client.eval.mock.calls[0]!;
    expect(script).toContain('GEN_READ_STATE');
    expect(script).not.toContain('cjson');
    expect(command.keys).toEqual([
      'mahoshojo:gen:v1:generation-1234:state', 'mahoshojo:gen:v1:generation-1234:snapshot',
    ]);
  });

  it.each([
    [state, '', 'SIDECAR_INVALID'],
    [state, `${sidecar} `, 'SIDECAR_INVALID'],
    [{ ...state, snapshotMeta: { ...state.snapshotMeta, lastEventId: '11-0' } }, sidecar, 'METADATA_INVALID'],
    [{ ...state, snapshotMeta: undefined }, sidecar, 'METADATA_INVALID'],
    [{ ...state, snapshot }, sidecar, 'METADATA_INVALID'],
    [{ ...state, storageVersion: 3 }, sidecar, 'STORAGE_VERSION_INVALID'],
  ])('fails closed on invalid storage evidence %#', async (stored, body, error) => {
    const client = createClient();
    client.eval.mockResolvedValue([JSON.stringify(stored), body]);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    await expect(store.readState({ generationId: reserveInput.generationId })).rejects.toThrow(String(error));
  });

  it('v1 reads ignore unrelated sidecars even when new reservations opt in', async () => {
    const client = createClient();
    client.eval.mockResolvedValue([JSON.stringify({ ...state, storageVersion: undefined, snapshot }), 'stale']);
    const store = createRedisGenerationReplayStore({ getClient: () => client, enableSnapshotSidecar: true });
    await expect(store.readSnapshot({ generationId: reserveInput.generationId })).resolves.toEqual(snapshot);
  });

  it.each([true, false, undefined])('preserves the internal terminal uncertainty bit: %s', async (replayUncertain) => {
    const client = createClient();
    const terminal = { status: 'completed', ...(replayUncertain === undefined ? {} : { replayUncertain }) };
    client.eval.mockResolvedValue([JSON.stringify({
      ...state, storageVersion: undefined, status: 'completed', leaseExpiresAt: null,
      terminal, snapshot: { ...snapshot, status: 'completed' },
    }), '']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    const restored = await store.readState({ generationId: reserveInput.generationId });
    expect(restored?.terminal).toEqual(terminal);
  });

  it.each([1, 2])('retains known uncertainty when layout %i snapshot evidence is corrupt', async (storageVersion) => {
    const client = createClient();
    client.eval.mockResolvedValue([JSON.stringify({
      ...state, storageVersion, status: 'completed', leaseExpiresAt: null,
      terminal: { status: 'completed', replayUncertain: true },
      snapshot: storageVersion === 1 ? { broken: true } : null,
    }), '']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    await expect(store.readState({ generationId: reserveInput.generationId }))
      .rejects.toThrow('REDIS_GENERATION_UNCERTAIN_SNAPSHOT_UNAVAILABLE');
  });

  it('rejects nonboolean uncertainty instead of coercing it', async () => {
    const client = createClient();
    client.eval.mockResolvedValue([JSON.stringify({
      ...state, storageVersion: undefined, status: 'completed', leaseExpiresAt: null,
      terminal: { status: 'completed', replayUncertain: 'false' }, snapshot: null,
    }), '']);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    await expect(store.readState({ generationId: reserveInput.generationId })).rejects.toThrow('STATE_INVALID');
  });

  it('discovers identity once, passes four keys, and never retries a failed write', async () => {
    const client = createClient();
    client.command.mockResolvedValue(1);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    const input = { generationId: reserveInput.generationId, producerToken: reserveInput.producerToken,
      now: reserveInput.now, leaseExpiresAt: reserveInput.leaseExpiresAt };
    await store.heartbeat(input);
    await store.heartbeat(input);
    expect(client.eval.mock.calls.filter(([script]) => script.includes('GEN_DISCOVER_IDENTITY'))).toHaveLength(1);
    const [script, command] = client.command.mock.calls[0]!;
    expect(command.keys).toEqual([
      'mahoshojo:gen:v1:generation-1234:state', 'mahoshojo:gen:v1:generation-1234:events',
      identityKey, 'mahoshojo:gen:v1:generation-1234:snapshot',
    ]);
    expect(script).toContain('state.reservationKey ~= KEYS[3]');
    client.command.mockRejectedValueOnce(new Error('unknown outcome'));
    await expect(store.heartbeat(input)).rejects.toThrow('unknown outcome');
    expect(client.command).toHaveBeenCalledTimes(3);
    await store.heartbeat(input);
    expect(client.eval.mock.calls.filter(([text]) => text.includes('GEN_DISCOVER_IDENTITY'))).toHaveLength(2);
  });

  it('cursor mismatch remains degraded rather than ownership loss', async () => {
    const client = createClient();
    client.command.mockRejectedValue(new Error('REDIS_GENERATION_SNAPSHOT_CURSOR_MISMATCH'));
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    await expect(store.writeSnapshot({
      generationId: reserveInput.generationId, producerToken: reserveInput.producerToken,
      snapshot: { ...snapshot, status: 'running' }, now: reserveInput.now,
    })).rejects.toThrow('SNAPSHOT_CURSOR_MISMATCH');
    expect(client.command).toHaveBeenCalledTimes(1);
  });
});

it('normalizes JSON null mode before returning a successful lease-reaper claim', async () => {
  const evaluate = vi.fn<RedisGenerationClient['eval']>(async (script) => script.includes('GEN_DISCOVER_IDENTITY')
    ? 'mahoshojo:gen:v1:req:user:hash:request-1234'
    : ['claimed', reserveInput.generationRequestId, reserveInput.payloadHash, '', '']);
  const store = createRedisGenerationReplayStore({ getClient: () => ({
    eval: evaluate, get: async () => null, xRead: async () => null,
  }) });
  await expect(store.claimLeaseExpiry({
    generationId: reserveInput.generationId, actorKey: reserveInput.actorKey,
    reaperToken: 'reaper', now: reserveInput.now, leaseExpiresAt: reserveInput.leaseExpiresAt,
  })).resolves.toMatchObject({ kind: 'claimed', mode: null });
  const script = evaluate.mock.calls.find(([text]) => text.includes('GEN_CLAIM_LEASE_EXPIRY_V1'))![0];
  expect(script).toContain("if mode == nil or mode == cjson.null then mode = '' end");
});

it('requestCancel 支持非房间预取消墓碑原子写入，且 RESERVATION_SCRIPT 支持首次消费接管', async () => {
  const client = {
    eval: vi.fn<RedisGenerationClient['eval']>(async () => 'accepted:user'),
    get: vi.fn<RedisGenerationClient['get']>(async () => null),
    xRead: vi.fn<RedisGenerationClient['xRead']>(async () => null),
  };
  const store = createRedisGenerationReplayStore({ getClient: () => client });

  await expect(store.requestCancel({
    generationId: reserveInput.generationId,
    actorKey: reserveInput.actorKey,
    reason: 'user',
    now: reserveInput.now,
    preCancelRequestId: reserveInput.generationRequestId,
  })).resolves.toEqual({ kind: 'accepted', cancelReason: 'user' });

  expect(client.eval).toHaveBeenCalledTimes(1);
  const [cancelScript, cancelOptions] = client.eval.mock.calls[0]!;
  expect(cancelScript).toContain('GEN_CANCEL_V1');
  expect(cancelScript).toContain("redis.call('XADD', KEYS[2]");
  expect(cancelOptions.keys[0]).toBe('mahoshojo:gen:v1:generation-1234:state');
  expect(cancelOptions.keys[1]).toBe('mahoshojo:gen:v1:generation-1234:events');
  expect(cancelOptions.keys[2]).toMatch(/^mahoshojo:gen:v1:req:user:[a-f0-9]{32}:request-1234$/u);
  expect(cancelOptions.arguments).toHaveLength(11);
  expect(JSON.parse(cancelOptions.arguments[7]!)).toMatchObject({
    generationId: reserveInput.generationId,
    preCancelled: true,
    payloadHash: '__PRE_CANCELLED__',
  });
  expect(JSON.parse(cancelOptions.arguments[8]!)).toMatchObject({
    status: 'cancelled',
    terminal: { status: 'cancelled', code: 'USER_CANCELLED' },
  });
  expect(JSON.parse(cancelOptions.arguments[9]!)).toEqual({
    ok: false,
    status: 'cancelled',
    code: 'USER_CANCELLED',
  });

  client.eval.mockResolvedValueOnce(['reused', reserveInput.generationId, '', '']);
  await expect(store.reserve(reserveInput)).resolves.toMatchObject({
    kind: 'reused',
    generationId: reserveInput.generationId,
  });
  const [reserveScript] = client.eval.mock.calls[1]!;
  expect(reserveScript).toContain("reservation.preCancelled == true and reservation.payloadHash == '__PRE_CANCELLED__'");
});
