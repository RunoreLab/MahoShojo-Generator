import { describe, expect, it, vi } from 'vitest';

import {
  ARENA_GENERATION_ACTOR_TOKEN_HEADER,
  ARENA_GENERATION_ACTOR_TOKEN_KEY,
  ARENA_GENERATION_CLIENT_STATE_KEY,
  arenaGenerationConnectionNotice,
  openArenaGenerationStream,
} from '@/lib/arena/resumable-generation-client';
import {
  STREAM_ABORT_REASON_CONTENT_POLICY,
  STREAM_ABORT_REASON_USER,
} from '@/lib/stream/abort';
import { GenerationApiClientError } from '@/lib/hono-api-client';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const response = (body: ReadableStream<Uint8Array> | string, generationId = 'generation-1') => new Response(body, {
  status: 200,
  headers: {
    'Content-Type': 'text/event-stream',
    'X-Mahoshojo-Generation-Id': generationId,
  },
});

const lookupResponse = (
  generationId = 'generation-1',
  generationRequestId = 'request-1234',
  lastEventId: string | null = null,
) => new Response(JSON.stringify({
  generationId,
  generationRequestId,
  status: 'running',
  resumable: true,
  lastEventId,
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const readWithDeadline = async <T>(
  read: Promise<T>,
  timeoutMs = 100,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('stream read did not settle')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

describe('resumable Arena generation client', () => {
  it('给取消确认与恢复状态提供稳定用户文案', () => {
    expect(arenaGenerationConnectionNotice('cancelling')).toContain('正在请求服务器停止');
    expect(arenaGenerationConnectionNotice('cancelled')).toContain('服务器已接受停止请求');
    expect(arenaGenerationConnectionNotice('cancel_unconfirmed')).toContain('可能仍在后台继续');
    expect(arenaGenerationConnectionNotice('reconnecting')).toContain('仍在服务器生成');
    expect(arenaGenerationConnectionNotice('completed')).toBeNull();
  });
  it('persists a bootstrap actor credential before the first POST', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get(ARENA_GENERATION_ACTOR_TOKEN_HEADER)).toMatch(/^bootstrap\.[0-9a-f-]{36}$/u);
      expect(storage.getItem(ARENA_GENERATION_ACTOR_TOKEN_KEY)).toBe(
        headers.get(ARENA_GENERATION_ACTOR_TOKEN_HEADER),
      );
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
    });

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage,
      generationRequestId: 'request-1234',
    });
    await opened.text();
  });

  it('reconnects with the last SSE id and never posts a second generation', async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const interrupted = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) {
          controller.enqueue(encoder.encode('id: 1-0\nevent: markdown\ndata: {"chunk":"A"}\n\n'));
        } else {
          controller.error(new Error('network lost'));
        }
      },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(interrupted))
      .mockResolvedValueOnce(response(
        'id: 2-0\nevent: markdown\ndata: {"chunk":"B"}\n\nid: 3-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));
    const storage = new MemoryStorage();

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream?format=sse',
      body: { combatants: [{}, {}] },
      headers: {},
      fetcher,
      storage,
      generationRequestId: 'request-1234',
      baseReconnectDelayMs: 1,
      random: () => 0,
    });

    await expect(opened.text()).resolves.toContain('data: {"chunk":"A"}');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/arena/generations/generation-1/stream?after=1-0');
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)!)).toMatchObject({
      generationId: 'generation-1',
      lastEventId: '3-0',
      state: 'completed',
    });
  });

  it('recovers a lost initial handshake by request-id lookup without another POST', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('response headers lost'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(lookupResponse('generation-1', 'request-1234', '99-0'))
      .mockResolvedValueOnce(response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream', body: {}, headers: {}, fetcher, storage,
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await opened.text();

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      ['/api/arena/generation-requests/request-1234', 'GET'],
      ['/api/arena/generation-requests/request-1234', 'GET'],
      ['/api/arena/generations/generation-1/stream', 'GET'],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      generationRequestId: 'request-1234',
    });
  });

  it.each([
    'DR_NOT_ELIGIBLE',
    'NO_READY_PLACEMENT',
    'OPERATION_NOT_DECLARED',
    'GENERATION_INTENT_ALREADY_DISPATCHED',
  ] as const)('does not recover a definite generation client error: %s', async (code) => {
    const error = new GenerationApiClientError(code, `definite: ${code}`);
    const fetcher = vi.fn().mockRejectedValue(error);
    const states: string[] = [];

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: `request-${code.toLowerCase().replaceAll('_', '-')}`,
      maxReconnectAttempts: 0,
      onStateChange: (state) => states.push(state),
    })).rejects.toBe(error);

    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST']);
    expect(states).toEqual(['connecting']);
    expect(states).not.toContain('recovering_initial');
  });

  it('does not recover an ordinary application Error from the initial POST', async () => {
    const error = new Error('application precondition failed');
    const fetcher = vi.fn().mockRejectedValue(error);
    const states: string[] = [];

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-application-error',
      maxReconnectAttempts: 0,
      onStateChange: (state) => states.push(state),
    })).rejects.toBe(error);

    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST']);
    expect(states).toEqual(['connecting']);
  });

  it('recovers AMBIGUOUS_OPERATION_OUTCOME by request-id lookup', async () => {
    const requestId = 'request-ambiguous-error';
    const error = new GenerationApiClientError(
      'AMBIGUOUS_OPERATION_OUTCOME',
      'request outcome is ambiguous',
    );
    const fetcher = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(lookupResponse('generation-ambiguous', requestId))
      .mockResolvedValueOnce(response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
        'generation-ambiguous',
      ));
    const states: string[] = [];

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: requestId,
      maxReconnectAttempts: 0,
      onStateChange: (state) => states.push(state),
    });
    await opened.text();

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      [`/api/arena/generation-requests/${requestId}`, 'GET'],
      ['/api/arena/generations/generation-ambiguous/stream', 'GET'],
    ]);
    expect(states).toContain('recovering_initial');
  });

  it.each([429, 502, 503, 504])(
    'recovers an ambiguous initial HTTP %s without replaying POST',
    async (status) => {
      const requestId = `request-http-${status}`;
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'TRANSIENT' }), { status }))
        .mockResolvedValueOnce(lookupResponse('generation-http', requestId))
        .mockResolvedValueOnce(response(
          'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
          'generation-http',
        ));

      const opened = await openArenaGenerationStream({
        endpoint: '/api/arena/generate-stream',
        body: { status },
        headers: {},
        fetcher,
        storage: new MemoryStorage(),
        generationRequestId: requestId,
        baseReconnectDelayMs: 1,
        random: () => 0,
      });
      await opened.text();

      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
      expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'GET']);
    },
  );

  it('returns a definite create rejection without lookup or retry', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      code: 'GENERATION_REQUEST_CONFLICT',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }));

    const rejected = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-definite-rejection',
    });

    expect(rejected.status).toBe(409);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('propagates a non-explicit abort while request-id lookup is in flight', async () => {
    const storage = new MemoryStorage();
    const abort = new AbortController();
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') throw new TypeError('initial response lost');
      markLookupStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('lookup aborted')),
          { once: true },
        );
      });
    });
    const opening = openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage,
      signal: abort.signal,
      generationRequestId: 'request-lookup-abort',
    });
    await lookupStarted;

    abort.abort('timeout');

    await expect(opening).rejects.toThrow('lookup aborted');
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)!)).toMatchObject({
      generationId: null,
      state: 'recovering_initial',
    });
  });

  it('propagates abort while reading a successful lookup response body', async () => {
    const storage = new MemoryStorage();
    const abort = new AbortController();
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') throw new TypeError('initial response lost');
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          markBodyStarted();
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new Error('lookup body aborted')),
            { once: true },
          );
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const opening = openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage,
      signal: abort.signal,
      generationRequestId: 'request-lookup-body-abort',
    });
    await bodyStarted;

    abort.abort('timeout');

    await expect(opening).rejects.toThrow('lookup body aborted');
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)!)).toMatchObject({
      generationId: null,
      state: 'recovering_initial',
    });
  });

  it('keeps a looked-up generation id when the first resume attempt fails', async () => {
    const storage = new MemoryStorage();
    const requestId = 'request-known-after-lookup';
    const firstFetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('initial response lost'))
      .mockResolvedValueOnce(lookupResponse('generation-known', requestId))
      .mockRejectedValueOnce(new TypeError('resume offline'));

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher: firstFetcher,
      storage,
      generationRequestId: requestId,
      maxReconnectAttempts: 0,
    })).rejects.toThrow('resume offline');
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)!)).toMatchObject({
      generationRequestId: requestId,
      generationId: 'generation-known',
      state: 'resuming',
    });

    const afterRefresh = vi.fn(async () => response(
      'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
      'generation-known',
    ));
    const resumed = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher: afterRefresh,
      storage,
    });
    await resumed.text();

    expect(afterRefresh.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generations/generation-known/stream', 'GET'],
    ]);
  });

  it('reuses a persisted pending handshake after refresh without changing request identity', async () => {
    const storage = new MemoryStorage();
    const seenRequestIds: string[] = [];
    const lostHandshake = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        seenRequestIds.push(JSON.parse(String(init.body)).generationRequestId as string);
        throw new TypeError('response headers lost before refresh');
      }
      return new Response(JSON.stringify({ code: 'GENERATION_REQUEST_NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { combatants: [{ name: 'A' }, { name: 'B' }] },
      headers: {},
      fetcher: lostHandshake,
      storage,
      maxReconnectAttempts: 0,
      random: () => 0,
    })).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');

    expect(lostHandshake.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      [expect.stringMatching(/^\/api\/arena\/generation-requests\//u), 'GET'],
    ]);
    expect(JSON.parse(storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)!)).toMatchObject({
      generationId: null,
      state: 'unknown',
    });

    const afterRefresh = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/generation-requests/')) {
        return lookupResponse('generation-after-refresh', seenRequestIds[0]);
      }
      return response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
        'generation-after-refresh',
      );
    });
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { combatants: [{ name: 'A' }, { name: 'B' }] },
      headers: {},
      fetcher: afterRefresh,
      storage,
    });
    await opened.text();

    expect(seenRequestIds).toHaveLength(1);
    expect(afterRefresh.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`/api/arena/generation-requests/${seenRequestIds[0]}`, 'GET'],
      ['/api/arena/generations/generation-after-refresh/stream', 'GET'],
    ]);
  });

  it.each([
    ['generationRequestId', { generationRequestId: 'bad' }],
    ['generationId', { generationId: 'bad' }],
  ] as const)('ignores persisted state with invalid %s', async (_field, invalidPatch) => {
    const storage = new MemoryStorage();
    const seedFetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('initial response lost'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic', persistedValidation: _field },
      headers: {},
      fetcher: seedFetcher,
      storage,
      maxReconnectAttempts: 0,
    })).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');

    const scopedStateKey = Array.from(storage.values.keys()).find((key) => (
      key.startsWith(`${ARENA_GENERATION_CLIENT_STATE_KEY}:`)
    ));
    expect(scopedStateKey).toBeTruthy();
    const persisted = JSON.parse(storage.getItem(scopedStateKey!)!);
    storage.setItem(scopedStateKey!, JSON.stringify({
      ...persisted,
      state: 'recovering_initial',
      ...invalidPatch,
    }));

    const fetcher = vi.fn(async () => response(
      'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
      'generation-fresh',
    ));
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic', persistedValidation: _field },
      headers: {},
      fetcher,
      storage,
      generationRequestId: 'request-fresh-1234',
      maxReconnectAttempts: 0,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/arena/generate-stream');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      generationRequestId: 'request-fresh-1234',
    });
  });

  it('rejects an invalid explicit request id before persistence or fetch', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn();

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage,
      generationRequestId: 'bad',
    })).rejects.toThrow('ARENA_GENERATION_REQUEST_ID_INVALID');

    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it('does not reuse a pending request identity for a different semantic body', async () => {
    const storage = new MemoryStorage();
    let firstRequestId = '';
    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher: vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          firstRequestId = JSON.parse(String(init.body)).generationRequestId as string;
          throw new TypeError('lost');
        }
        return new Response(null, { status: 404 });
      }),
      storage,
      maxReconnectAttempts: 0,
    })).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');

    let secondRequestId = '';
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'scenario' },
      headers: {},
      fetcher: vi.fn(async (_url: string, init?: RequestInit) => {
        secondRequestId = JSON.parse(String(init?.body)).generationRequestId as string;
        return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
      }),
      storage,
    });
    await opened.text();

    expect(secondRequestId).not.toBe(firstRequestId);
  });

  it('resumes with no cursor when the first response disconnects before any bytes', async () => {
    const disconnected = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('lost before first byte')); },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(disconnected))
      .mockResolvedValueOnce(response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/arena/generations/generation-1/stream');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('GET');
  });

  it('survives repeated network toggles with monotonic cursors and one POST', async () => {
    const interrupted = (id: string, chunk: string) => {
      let reads = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          reads += 1;
          if (reads === 1) {
            controller.enqueue(new TextEncoder().encode(
              `id: ${id}\nevent: markdown\ndata: {"chunk":"${chunk}"}\n\n`,
            ));
          } else {
            controller.error(new Error('network toggle'));
          }
        },
      });
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(interrupted('1-0', 'A')))
      .mockResolvedValueOnce(response(interrupted('2-0', 'B')))
      .mockResolvedValueOnce(response(
        'id: 3-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await expect(opened.text()).resolves.toContain('{"chunk":"B"}');

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      ['/api/arena/generations/generation-1/stream?after=1-0', 'GET'],
      ['/api/arena/generations/generation-1/stream?after=2-0', 'GET'],
    ]);
  });

  it('keeps the issued anonymous actor token in memory when browser storage is unavailable', async () => {
    const interrupted = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('network lost')); },
    });
    const seenTokens: Array<string | null> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      seenTokens.push(new Headers(init?.headers).get(ARENA_GENERATION_ACTOR_TOKEN_HEADER));
      if (seenTokens.length === 1) {
        return new Response(interrupted, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'X-Mahoshojo-Generation-Id': 'generation-memory-token',
            [ARENA_GENERATION_ACTOR_TOKEN_HEADER]: 'signed.anonymous.actor',
          },
        });
      }
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n', 'generation-memory-token');
    });

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic', storage: 'disabled' },
      headers: {},
      fetcher,
      storage: null,
      generationRequestId: 'request-storage-disabled',
      baseReconnectDelayMs: 1,
      random: () => 0,
    });
    await opened.text();

    expect(seenTokens[0]).toMatch(/^bootstrap\./u);
    expect(seenTokens[1]).toBe('signed.anonymous.actor');
  });

  it('retries transient resume HTTP failures without issuing another POST', async () => {
    const disconnected = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('network lost')); },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(disconnected, 'generation-transient'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'STATE_UNAVAILABLE' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
        'generation-transient',
      ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic', transient: true },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-transient-resume',
      baseReconnectDelayMs: 1,
      random: () => 0,
    });
    await opened.text();

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      ['/api/arena/generations/generation-transient/stream', 'GET'],
      ['/api/arena/generations/generation-transient/stream', 'GET'],
    ]);
  });

  it('does not use an unscoped v1 pointer to resume a possibly different request body', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ARENA_GENERATION_CLIENT_STATE_KEY, JSON.stringify({
      version: 1,
      generationRequestId: 'request-1234',
      generationId: 'generation-1',
      lastEventId: '8-0',
      state: 'generating',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }));
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => response(
      'id: 9-0\nevent: done\ndata: {"status":"completed"}\n\n',
    ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream?format=sse',
      body: {},
      headers: {},
      fetcher,
      storage,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/arena/generate-stream?format=sse');
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toMatchObject({
      generationRequestId: 'request-1234',
    });
  });

  it('recovers an incomplete 200 handshake by request-id lookup without another POST', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('upstream bytes without generation header', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(lookupResponse('generation-1', 'request-incomplete'))
      .mockResolvedValueOnce(response(
        'id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n',
      ));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage,
      generationRequestId: 'request-incomplete',
      baseReconnectDelayMs: 1,
      random: () => 0,
    });
    await opened.text();

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/api/arena/generate-stream', 'POST'],
      [expect.stringMatching(/^\/api\/arena\/generation-requests\//u), 'GET'],
      ['/api/arena/generations/generation-1/stream', 'GET'],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toHaveProperty(
      'generationRequestId',
    );
  });

  it('ignores replayed SSE blocks whose ids do not advance the local cursor', async () => {
    const fetcher = vi.fn(async () => response([
      'id: 2-0\nevent: markdown\ndata: {"chunk":"new"}',
      'id: 1-0\nevent: markdown\ndata: {"chunk":"stale"}',
      'id: 3-0\nevent: done\ndata: {"status":"completed"}',
      '',
    ].join('\n\n')));

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {},
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-monotonic-cursor',
    });
    const streamed = await opened.text();

    expect(streamed).toContain('"chunk":"new"');
    expect(streamed).not.toContain('"chunk":"stale"');
  });

  it('subscriber cancellation does not call explicit cancel', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url.includes('/cancel')) return new Response(null, { status: 202 });
      return response(new ReadableStream<Uint8Array>({ start() {} }));
    });
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234',
    });
    await opened.body!.cancel('tab closed');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['user stop', 'user', 'user'],
    ['content-policy abort', STREAM_ABORT_REASON_CONTENT_POLICY, 'content_policy'],
  ])('ends a pending wrapper read after %s and explicitly cancels the producer once', async (
    _label,
    abortReason,
    cancelReason,
  ) => {
    const states: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url.includes('/cancel')) return new Response(null, { status: 202 });
      return response(new ReadableStream<Uint8Array>({ start() {} }));
    });
    const abort = new AbortController();
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: `request-${cancelReason}`, signal: abort.signal,
      onStateChange: (state) => states.push(state),
    });
    const pendingRead = opened.body!.getReader().read();

    abort.abort(abortReason);
    await expect(readWithDeadline(pendingRead)).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const explicitCancels = fetcher.mock.calls.filter(([url]) => String(url).includes('/cancel'));
    expect(explicitCancels).toHaveLength(1);
    expect(explicitCancels[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ reason: cancelReason }),
    });
    expect(states).toContain('cancelling');
    expect(states.at(-1)).toBe('cancelled');
  });

  it.each([
    ['fetch reject', async () => { throw new Error('offline'); }],
    ['server 503', async () => new Response(null, { status: 503 })],
  ])('does not claim server cancellation when cancel %s', async (_label, cancelResponse) => {
    const states: string[] = [];
    const fetcher = vi.fn(async (url: string): Promise<Response> => {
      if (url.includes('/cancel')) return cancelResponse();
      return response(new ReadableStream<Uint8Array>({ start() {} }));
    });
    const abort = new AbortController();
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {},
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: `request-cancel-${_label.replace(/\s/gu, '-')}`,
      signal: abort.signal,
      onStateChange: (state) => states.push(state),
    });
    const pendingRead = opened.body!.getReader().read();

    abort.abort(STREAM_ABORT_REASON_USER);

    await expect(readWithDeadline(pendingRead)).resolves.toEqual({
      value: undefined,
      done: true,
    });
    expect(states).toContain('cancelling');
    expect(states.at(-1)).toBe('cancel_unconfirmed');
    expect(states).not.toContain('cancelled');
  });

  it('times out cancel confirmation instead of claiming cancellation', async () => {
    const states: string[] = [];
    const fetcher = vi.fn(async (url: string): Promise<Response> => {
      if (url.includes('/cancel')) return new Promise<Response>(() => undefined);
      return response(new ReadableStream<Uint8Array>({ start() {} }));
    });
    const abort = new AbortController();
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {},
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-cancel-timeout',
      signal: abort.signal,
      cancelConfirmationTimeoutMs: 5,
      onStateChange: (state) => states.push(state),
    });
    const pendingRead = opened.body!.getReader().read();

    abort.abort(STREAM_ABORT_REASON_USER);

    await expect(readWithDeadline(pendingRead)).resolves.toEqual({
      value: undefined,
      done: true,
    });
    expect(states.at(-1)).toBe('cancel_unconfirmed');
  });

  it('does not resume after explicit abort wins during reconnect backoff', async () => {
    let markReconnecting!: () => void;
    const reconnecting = new Promise<void>((resolve) => { markReconnecting = resolve; });
    const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('/cancel')) return new Response(null, { status: 202 });
      if (init?.method === 'GET' && url.includes('/stream')) {
        return new Promise<Response>(() => undefined);
      }
      return response(new ReadableStream<Uint8Array>({
        start(controller) { controller.close(); },
      }));
    });
    const abort = new AbortController();
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {},
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-abort-during-reconnect',
      signal: abort.signal,
      baseReconnectDelayMs: 1,
      random: () => 0,
      onStateChange(state) {
        if (state === 'reconnecting') markReconnecting();
      },
    });
    const pendingRead = opened.body!.getReader().read();
    await reconnecting;

    abort.abort('user');

    await expect(readWithDeadline(pendingRead)).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/cancel'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url, init]) => (
      init?.method === 'GET' && String(url).includes('/stream')
    ))).toBe(false);
  });

  it('closes without waiting for backoff when reconnect state synchronously triggers stop', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('/cancel')) return new Response(null, { status: 202 });
      if (init?.method === 'GET' && url.includes('/stream')) {
        return new Promise<Response>(() => undefined);
      }
      return response(new ReadableStream<Uint8Array>({
        start(controller) { controller.close(); },
      }));
    });
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {},
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-stop-from-reconnecting-state',
      signal: abort.signal,
      baseReconnectDelayMs: 30_000,
      random: () => 0,
      onStateChange(state) {
        if (state === 'reconnecting') abort.abort('user');
      },
    });

    await expect(readWithDeadline(opened.body!.getReader().read())).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/cancel'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url, init]) => (
      init?.method === 'GET' && String(url).includes('/stream')
    ))).toBe(false);
  });

  it('cancels by stable request id when the user stops before POST response headers arrive', async () => {
    const abort = new AbortController();
    let markPostStarted!: () => void;
    const postStarted = new Promise<void>((resolve) => { markPostStarted = resolve; });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'DELETE') return new Response(null, { status: 202 });
      markPostStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const opened = openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-pending-cancel',
      signal: abort.signal,
    });
    await postStarted;

    abort.abort('user');
    await expect(opened).rejects.toThrow('aborted');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pendingCancel = fetcher.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(pendingCancel?.[0]).toBe('/api/arena/generate-stream');
    expect(pendingCancel?.[1]?.body).toBe(JSON.stringify({
      generationRequestId: 'request-pending-cancel',
      reason: 'user',
    }));
  });

  it('does not start POST when user cancellation wins during client initialization', async () => {
    const abort = new AbortController();
    abort.abort('user');
    const fetcher = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'DELETE') return new Response(null, { status: 202 });
      throw new Error('POST_SHOULD_NOT_START');
    });

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage: new MemoryStorage(),
      generationRequestId: 'request-pre-cancelled',
      signal: abort.signal,
    })).rejects.toThrow('ARENA_GENERATION_CANCELLED');

    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });
});
