import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openArenaGenerationStreamClient,
  type ArenaGenerationClientOptions,
  type ArenaGenerationClientPorts,
  type ArenaGenerationConnectionState,
  type GenerationApiRoutePin,
  type PersistedArenaGeneration,
} from '@mahoshojo/hosted-api/arena-generation/client';

// 仅证明 C0 核可被有限 Native-shaped adapter 消费，不是真正 IPC、凭据策略或 Desktop 产品接线。
// 消息只有操作、受检标识符、cursor、公开 placement 和取消理由；无 method/path/header/origin。
type NativeMessage =
  | { operation: 'create'; requestId: string }
  | { operation: 'lookup'; requestId: string; placement: GenerationApiRoutePin['placement'] | null }
  | { operation: 'resume'; generationId: string; after: string | null; placement: GenerationApiRoutePin['placement'] | null }
  | { operation: 'cancel'; requestId: string; generationId: string | null; reason: 'user' | 'content_policy' };
const REQUEST_ID = 'request-native-01';
const GENERATION_ID = 'generation-native-01';
const PIN: GenerationApiRoutePin = { placement: 'hono-primary' };
const ENDPOINT = 'arena-stream'; // 核只把它作为恢复身份；transport 不接收它
const NOW = '2026-10-10T00:00:00.000Z';
const HASH = 'synthetic-semantic-body-hash';
const DONE = 'id: 3-0\nevent: done\ndata: {"status":"completed"}\n\n';
const stream = (body: string | ReadableStream<Uint8Array>) => new Response(body, {
  headers: { 'Content-Type': 'text/event-stream', 'X-Mahoshojo-Generation-Id': GENERATION_ID },
});
const lookup = () => Response.json({ generationRequestId: REQUEST_ID, generationId: GENERATION_ID, status: 'running' });
const publicState = (extra: Partial<PersistedArenaGeneration> = {}): PersistedArenaGeneration => ({
  version: 3, generationRequestId: REQUEST_ID, generationId: GENERATION_ID, lastEventId: '2-0',
  state: 'generating', updatedAt: NOW, endpoint: ENDPOINT, bodyHash: HASH, routePin: PIN, ...extra,
});
const validId = (value: string): string => {
  expect(value).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);
  return value;
};
const nativeHarness = (
  replies: Array<Response | Error>,
  previous: PersistedArenaGeneration | null = null,
  overrides: Partial<ArenaGenerationClientOptions> = {},
) => {
  const messages: NativeMessage[] = [];
  const states: ArenaGenerationConnectionState[] = [];
  const saved: PersistedArenaGeneration[] = [];
  const waits: number[] = [];
  const dispatch = async (message: NativeMessage) => {
    messages.push(message);
    const reply = replies.shift();
    if (!reply) throw new Error('UNEXPECTED_NATIVE_OPERATION');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const ports: ArenaGenerationClientPorts = {
    loadState: () => previous,
    saveState: (state) => { saved.push(structuredClone(state)); },
    createRequestId: () => REQUEST_ID,
    encodeUtf8: (value) => new TextEncoder().encode(value),
    waitForReconnectOpportunity: async (milliseconds) => { waits.push(milliseconds); },
    isInitialCreateOutcomeAmbiguous: (error) => error instanceof TypeError,
    classifyExplicitAbort: (reason) => reason === 'user' || reason === 'content_policy' ? reason : null,
    prepareCreate: vi.fn(), observeResponse: vi.fn(),
    transport: {
      create: (input) => {
        expect(Object.keys(input).sort()).toEqual(['generationRequestId', 'onRoutePinSelected', 'signal']);
        const { generationRequestId, onRoutePinSelected } = input;
        onRoutePinSelected(PIN);
        return dispatch({ operation: 'create', requestId: validId(generationRequestId) });
      },
      lookup: (input) => {
        expect(Object.keys(input).sort()).toEqual(['generationRequestId', 'routePin', 'signal']);
        const { generationRequestId, routePin } = input;
        return dispatch({ operation: 'lookup', requestId: validId(generationRequestId), placement: routePin?.placement ?? null });
      },
      resume: (input) => {
        expect(Object.keys(input).sort()).toEqual(['generationId', 'lastEventId', 'routePin', 'signal']);
        const { generationId, lastEventId, routePin } = input;
        if (lastEventId !== null) expect(lastEventId).toMatch(/^\d+-\d+$/u);
        return dispatch({ operation: 'resume', generationId: validId(generationId), after: lastEventId,
          placement: routePin?.placement ?? null });
      },
      cancel: (input) => {
        expect(Object.keys(input).sort()).toEqual(['generationId', 'generationRequestId', 'reason', 'signal']);
        const { generationRequestId, generationId, reason } = input;
        return dispatch({ operation: 'cancel', requestId: validId(generationRequestId),
          generationId: generationId === null ? null : validId(generationId), reason });
      },
    },
  };
  const options: ArenaGenerationClientOptions = {
    endpoint: ENDPOINT, bodyHash: HASH, now: () => new Date(NOW), random: () => 0.5,
    onStateChange: (state) => { states.push(state); }, ...overrides,
  };
  return { options, ports, messages, states, saved, waits };
};
const createMessage: NativeMessage = { operation: 'create', requestId: REQUEST_ID };
const lookupMessage: NativeMessage = { operation: 'lookup', requestId: REQUEST_ID, placement: 'hono-primary' };
const resumeMessage = (after: string | null = null): NativeMessage => ({
  operation: 'resume', generationId: GENERATION_ID, after, placement: 'hono-primary',
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Arena client finite Native-shaped adapter', () => {
  it('未知 create 只用同一 ID lookup/resume，消息和持久状态均只有公开恢复信息', async () => {
    const run = nativeHarness([new TypeError('response lost'), lookup(), stream(DONE)]);
    const opened = await openArenaGenerationStreamClient(run.options, run.ports);
    expect(await opened.text()).toBe(DONE);
    expect(run.messages).toEqual([createMessage, lookupMessage, resumeMessage()]);
    expect(run.states).toEqual(['connecting', 'recovering_initial', 'resuming', 'resuming', 'completed']);
    expect(run.saved.at(-1)).toEqual(publicState({ lastEventId: '3-0', state: 'completed' }));
    expect(run.ports.prepareCreate).toHaveBeenCalledExactlyOnceWith(REQUEST_ID);
    const publicKeys = ['version', 'generationRequestId', 'generationId', 'lastEventId', 'state', 'updatedAt', 'endpoint', 'bodyHash', 'routePin'];
    for (const state of run.saved) expect(Object.keys(state).sort()).toEqual([...publicKeys].sort());
  });

  it('默认八次恢复预算和 500ms 指数回退保持固定金样，不重复 create', async () => {
    const run = nativeHarness([new TypeError('response lost'),
      ...Array.from({ length: 9 }, () => new Response(null, { status: 404 }))]);
    await expect(openArenaGenerationStreamClient(run.options, run.ports)).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');
    expect(run.messages).toEqual([createMessage, ...Array.from({ length: 9 }, () => lookupMessage)]);
    expect(run.waits).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(run.states).toEqual(['connecting', 'recovering_initial', 'unknown']);
  });

  it('已知恢复 ID 跳过 create/lookup，保留 cursor，瞬态失败只重试 resume', async () => {
    const run = nativeHarness([new Response(null, { status: 503 }), stream(DONE)], publicState());
    expect(await (await openArenaGenerationStreamClient(run.options, run.ports)).text()).toBe(DONE);
    expect(run.messages).toEqual([resumeMessage('2-0'), resumeMessage('2-0')]);
    expect(run.waits).toEqual([500]);
    expect(run.states).toEqual(['resuming', 'resuming', 'reconnecting', 'resuming', 'resuming', 'completed']);
  });

  it('半包断流用最后完整 cursor 恢复；去重后交付 snapshot 与终态', async () => {
    const first = 'id: 1-0\nevent: markdown\ndata: {"text":"A"}\n\n';
    const snapshot = 'id: 2-0\nevent: snapshot\ndata: {"markdown":"AB"}\n\n';
    let pulled = false;
    const interrupted = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulled) { controller.error(new TypeError('disconnect')); return; }
      pulled = true;
      controller.enqueue(new TextEncoder().encode(`${first}id: 2-0\nevent: snapshot\ndata: {"markdown":`));
    } });
    const invalid = 'id: bad-id\nevent: markdown\ndata: {"text":"invalid"}\n\n';
    const run = nativeHarness([stream(interrupted), stream(first + invalid + snapshot + DONE)]);
    expect(await (await openArenaGenerationStreamClient(run.options, run.ports)).text()).toBe(first + snapshot + DONE);
    expect(run.messages).toEqual([createMessage, resumeMessage('1-0')]);
    expect(run.waits).toEqual([500]);
  });

  it.each([[202, 'cancelled'], [409, 'cancel_unconfirmed'], [404, 'cancel_unconfirmed']] as const)(
    'cancel %s 保持 %s，不变为完成或允许重新 create', async (status, finalState) => {
      const controller = new AbortController();
      const run = nativeHarness([stream(new ReadableStream<Uint8Array>()), new Response(null, { status })],
        null, { signal: controller.signal });
      const opened = await openArenaGenerationStreamClient(run.options, run.ports);
      controller.abort('user');
      expect(await opened.text()).toBe('');
      expect(run.messages).toEqual([createMessage, {
        operation: 'cancel', requestId: REQUEST_ID, generationId: GENERATION_ID, reason: 'user',
      }]);
      expect(run.states).toEqual(['connecting', 'generating', 'cancelling', finalState]);
    },
  );

  it('普通订阅关闭不产生 cancel；明确 content_policy 停止才产生 cancel', async () => {
    const ordinary = nativeHarness([stream(new ReadableStream<Uint8Array>())]);
    const opened = await openArenaGenerationStreamClient(ordinary.options, ordinary.ports);
    await opened.body!.cancel('reader detached');
    expect(ordinary.messages).toEqual([createMessage]);
    expect(ordinary.states).toEqual(['connecting', 'generating']);

    const controller = new AbortController();
    controller.abort('content_policy');
    const explicit = nativeHarness([new Response(null, { status: 202 })], null, { signal: controller.signal });
    await expect(openArenaGenerationStreamClient(explicit.options, explicit.ports)).rejects.toThrow('ARENA_GENERATION_CANCELLED');
    expect(explicit.messages).toEqual([{
      operation: 'cancel', requestId: REQUEST_ID, generationId: null, reason: 'content_policy',
    }]);
    expect(explicit.states).toEqual(['connecting', 'cancelling', 'cancelled']);
  });

  it('cancel 超时只确认失败，有限 stop request 使用独立 signal 并触发 abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const run = nativeHarness([stream(new ReadableStream<Uint8Array>())], null,
      { signal: controller.signal, cancelConfirmationTimeoutMs: 40 });
    let stopSignal: AbortSignal | undefined;
    run.ports.transport.cancel = ({ signal }) => {
      stopSignal = signal;
      return new Promise<Response>(() => {});
    };
    const opened = await openArenaGenerationStreamClient(run.options, run.ports);
    controller.abort('user');
    const body = opened.text();
    await vi.advanceTimersByTimeAsync(40);
    expect(await body).toBe('');
    expect(stopSignal).not.toBe(controller.signal);
    expect(stopSignal?.aborted).toBe(true);
    expect(run.states).toEqual(['connecting', 'generating', 'cancelling', 'cancel_unconfirmed']);
  });

  it('browser 显式子路径仅打包 client + SSE，无宿主 IO 或 server/Native 依赖且可独立运行', async () => {
    const result = await build({
      entryPoints: ['@mahoshojo/hosted-api/arena-generation/client'],
      bundle: true, platform: 'browser', format: 'iife', globalName: 'ArenaRecovery',
      write: false, metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile!.inputs).map((path) => path.replaceAll('\\', '/'));
    expect(inputs.sort()).toEqual(['src/arena-generation/client.ts', 'src/arena-generation/sse.ts']);
    expect(Object.values(result.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
    const code = result.outputFiles![0]!.text;
    expect(code).not.toMatch(/\b(?:window|document|localStorage|sessionStorage|fetch)\b/u);
    expect(code).not.toMatch(/(?:server-only|node:|@tauri-apps|providerKey|Authorization|Generation-Actor-Token)/u);
    const sandbox: Record<string, unknown> = {
      TextEncoder, TextDecoder, Response, Headers, ReadableStream, AbortController, setTimeout, clearTimeout,
    };
    for (const name of ['window', 'document', 'localStorage', 'sessionStorage', 'fetch']) {
      Object.defineProperty(sandbox, name, { get() { throw new Error(`FORBIDDEN_HOST_IO:${name}`); } });
    }
    runInNewContext(code, sandbox);
    const bundled = sandbox.ArenaRecovery as { openArenaGenerationStreamClient: typeof openArenaGenerationStreamClient };
    const run = nativeHarness([stream(DONE)]);
    expect(await (await bundled.openArenaGenerationStreamClient(run.options, run.ports)).text()).toBe(DONE);
    expect(run.messages).toEqual([createMessage]);
  });
});
