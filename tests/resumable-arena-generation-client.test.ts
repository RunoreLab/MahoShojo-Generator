import { describe, expect, it, vi } from 'vitest';

import {
  ARENA_GENERATION_ACTOR_TOKEN_HEADER,
  ARENA_GENERATION_ACTOR_TOKEN_KEY,
  ARENA_GENERATION_CLIENT_STATE_KEY,
  openArenaGenerationStream,
} from '@/lib/arena/resumable-generation-client';

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

describe('resumable Arena generation client', () => {
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

  it('retries a lost initial handshake with the identical idempotency identity', async () => {
    const storage = new MemoryStorage();
    const seen: Array<{ body: string; actor: string | null }> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push({
        body: String(init?.body ?? ''),
        actor: new Headers(init?.headers).get(ARENA_GENERATION_ACTOR_TOKEN_HEADER),
      });
      if (seen.length === 1) throw new TypeError('response headers lost');
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
    });
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream', body: {}, headers: {}, fetcher, storage,
      generationRequestId: 'request-1234', baseReconnectDelayMs: 1, random: () => 0,
    });
    await opened.text();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ generationRequestId: 'request-1234' });
  });

  it('reuses a persisted pending handshake after refresh without changing request identity', async () => {
    const storage = new MemoryStorage();
    const seenRequestIds: string[] = [];
    const lostHandshake = vi.fn(async (_url: string, init?: RequestInit) => {
      seenRequestIds.push(JSON.parse(String(init?.body)).generationRequestId as string);
      throw new TypeError('response headers lost before refresh');
    });

    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { combatants: [{ name: 'A' }, { name: 'B' }] },
      headers: {},
      fetcher: lostHandshake,
      storage,
      maxReconnectAttempts: 0,
      random: () => 0,
    })).rejects.toThrow('response headers lost before refresh');

    const afterRefresh = vi.fn(async (_url: string, init?: RequestInit) => {
      seenRequestIds.push(JSON.parse(String(init?.body)).generationRequestId as string);
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
    });
    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { combatants: [{ name: 'A' }, { name: 'B' }] },
      headers: {},
      fetcher: afterRefresh,
      storage,
    });
    await opened.text();

    expect(seenRequestIds).toHaveLength(2);
    expect(seenRequestIds[0]).toBe(seenRequestIds[1]);
  });

  it('does not reuse a pending request identity for a different semantic body', async () => {
    const storage = new MemoryStorage();
    let firstRequestId = '';
    await expect(openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher: vi.fn(async (_url: string, init?: RequestInit) => {
        firstRequestId = JSON.parse(String(init?.body)).generationRequestId as string;
        throw new TypeError('lost');
      }),
      storage,
      maxReconnectAttempts: 0,
    })).rejects.toThrow('lost');

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

  it('retries an incomplete 200 handshake with the same request identity', async () => {
    const storage = new MemoryStorage();
    const seenRequestIds: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      seenRequestIds.push(JSON.parse(String(init?.body)).generationRequestId as string);
      if (seenRequestIds.length === 1) {
        return new Response('upstream bytes without generation header', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return response('id: 1-0\nevent: done\ndata: {"status":"completed"}\n\n');
    });

    const opened = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: { mode: 'classic' },
      headers: {},
      fetcher,
      storage,
      baseReconnectDelayMs: 1,
      random: () => 0,
    });
    await opened.text();

    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST']);
    expect(seenRequestIds[0]).toBe(seenRequestIds[1]);
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

  it('subscriber cancellation does not call explicit cancel, while user stop does', async () => {
    let keepOpen!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/cancel')) return new Response(null, { status: 202 });
      return response(new ReadableStream<Uint8Array>({
        start(controller) { keepOpen = controller; },
      }));
    });
    const first = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-1234',
    });
    await first.body!.cancel('tab closed');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const abort = new AbortController();
    const second = await openArenaGenerationStream({
      endpoint: '/api/arena/generate-stream',
      body: {}, headers: {}, fetcher, storage: new MemoryStorage(),
      generationRequestId: 'request-5678', signal: abort.signal,
    });
    abort.abort('user');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/cancel'))).toBe(true);
    void second;
    void keepOpen;
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
