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
  now: '2026-08-25T04:00:00.000Z',
  leaseExpiresAt: '2026-08-25T04:01:00.000Z',
};

describe('RedisGenerationReplayStore', () => {
  it('用单次 Lua reservation 建立 request identity 与 producer ownership，key 不含明文 actor', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(['created', 'generation-1234']);
    const store = createRedisGenerationReplayStore({
      getClient: () => client,
      activeTtlSeconds: 3_600,
    });

    await expect(store.reserve(reserveInput)).resolves.toEqual({
      kind: 'created',
      generationId: 'generation-1234',
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
  });

  it.each([
    [['reused', 'generation-existing'], { kind: 'reused', generationId: 'generation-existing' }],
    [['conflict', ''], { kind: 'conflict' }],
  ] as const)('严格解析 reservation 结果 %j', async (raw, expected) => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(raw);
    const store = createRedisGenerationReplayStore({ getClient: () => client });

    await expect(store.reserve(reserveInput)).resolves.toEqual(expected);
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
      events: [
        { type: 'markdown', data: { chunk: 'A' } },
        { type: 'reasoning', data: { chunk: 'R' } },
      ],
      now: reserveInput.now,
    })).resolves.toEqual({
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

  it('没有立即事件时使用 XREAD tail，不使用 consumer group', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce(['events', '[]']);
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

  it('owner read/cancel 以 actor hash 校验并隐藏他人的 generation', async () => {
    const client = createClient();
    const state = {
      actorKey: 'placeholder',
      generationId: 'generation-1234',
      generationRequestId: 'request-1234',
      payloadHash: 'payload-sha256',
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

  it('terminal 更新使用 CAS，重复 finalization 不会再次生效', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const store = createRedisGenerationReplayStore({ getClient: () => client });
    const input = {
      generationId: 'generation-1234',
      terminal: { status: 'completed' as const, resultRef: 'r2://report/1' },
      now: reserveInput.now,
    };

    await expect(store.markTerminal(input)).resolves.toEqual({ applied: true });
    await expect(store.markTerminal(input)).resolves.toEqual({ applied: false });
    expect(vi.mocked(client.eval).mock.calls[0]?.[0]).toContain('GEN_TERMINAL_V1');
  });
});
