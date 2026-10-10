import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  authStorage: { getAuthHeader: async () => null, getActivityHeaders: async () => ({}) },
}));

import {
  ARENA_GENERATION_ACTOR_TOKEN_KEY, ARENA_GENERATION_CLIENT_STATE_KEY,
  arenaGenerationConnectionNotice, openArenaGenerationStream, readPersistedArenaGeneration,
  type ArenaGenerationConnectionState, type OpenArenaGenerationStreamOptions,
} from '@/lib/arena/resumable-generation-client';
import {
  createGenerationApiIntent, createPinnedGenerationApiSafeReadDispatcher, type GenerationApiRoutePin,
} from '@/lib/hono-api-client';
import { honoApiConfig, resolveHostedApiConfig } from '@/config/hono-api';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import hostedRouting from '../../../config/hosted-routing.json';

// 固定金样先在 708907f178487e835ab65472a4334fbb37b42939 的旧 Web 实现上运行。
// 不嵌入旧生产源码；抽取后真实 Web wrapper 必须保持这些外部可观察轨迹。
const ENDPOINT = '/api/arena/generate-stream';
const REQUEST_ID = 'request-golden-01';
const GENERATION_ID = 'generation-golden-01';
const NOW = '2026-10-10T00:00:00.000Z';
const PIN: GenerationApiRoutePin = { placement: 'hono-primary' };
const DONE = 'id: 3-0\nevent: done\ndata: {"status":"completed"}\n\n';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const bodyHash = sha256('{"mode":"classic"}');
const scopedKey = `${ARENA_GENERATION_CLIENT_STATE_KEY}:${sha256(`${ENDPOINT}\n${bodyHash}`)}`;
class MemoryStorage {
  readonly values = new Map<string, string>([[ARENA_GENERATION_ACTOR_TOKEN_KEY, 'synthetic-actor']]);
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
type Call = { method: string; path: string; pin: GenerationApiRoutePin | null; body: unknown };
const stream = (body: string | ReadableStream<Uint8Array>) => new Response(body, {
  headers: { 'Content-Type': 'text/event-stream', 'X-Mahoshojo-Generation-Id': GENERATION_ID },
});
const lookup = () => Response.json({
  generationRequestId: REQUEST_ID, generationId: GENERATION_ID, status: 'running',
  lastEventId: '999-0', // server head 不是本地已交付 cursor
});
const recordedFetcher = (
  replies: Array<Response | Error>, calls: Call[],
): OpenArenaGenerationStreamOptions['fetcher'] => async (path, init, pin, onPin) => {
  calls.push({ method: init?.method ?? 'GET', path, pin: pin ?? null,
    body: init?.body ? JSON.parse(String(init.body)) : null });
  if (init?.method === 'POST' && path === ENDPOINT) onPin?.(PIN);
  const reply = replies.shift();
  if (!reply) throw new Error('UNEXPECTED_EXTRA_REQUEST');
  if (reply instanceof Error) throw reply;
  return reply;
};
const createCall: Call = { method: 'POST', path: ENDPOINT, pin: null,
  body: { mode: 'classic', generationRequestId: REQUEST_ID } };
const lookupCall: Call = {
  method: 'GET', path: `/api/arena/generation-requests/${REQUEST_ID}`, pin: PIN, body: null,
};
const resumeCall = (after = '', pin: GenerationApiRoutePin | null = PIN): Call => ({
  method: 'GET', path: `/api/arena/generations/${GENERATION_ID}/stream${after ? `?after=${after}` : ''}`,
  pin, body: null,
});
const options = (replies: Array<Response | Error>, overrides: Partial<OpenArenaGenerationStreamOptions> = {}) => {
  const calls: Call[] = [];
  const states: ArenaGenerationConnectionState[] = [];
  const storage = new MemoryStorage();
  const input: OpenArenaGenerationStreamOptions = {
    endpoint: ENDPOINT, body: { mode: 'classic' }, headers: {}, generationRequestId: REQUEST_ID, storage,
    now: () => new Date(NOW), random: () => 0.5, maxReconnectAttempts: 3, baseReconnectDelayMs: 0,
    fetcher: recordedFetcher(replies, calls), onStateChange: (state) => { states.push(state); }, ...overrides,
  };
  return { input, calls, states, storage };
};
const previous = (version: 1 | 2 | 3, extra: Record<string, unknown> = {}) => ({
  version, generationRequestId: REQUEST_ID, generationId: GENERATION_ID,
  lastEventId: '2-0', state: 'generating', updatedAt: NOW, endpoint: ENDPOINT, bodyHash,
  ...(version === 3 ? { routePin: PIN } : {}), ...extra,
});
const initialConfig = { ...honoApiConfig };
afterEach(() => { Object.assign(honoApiConfig, initialConfig); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Arena 恢复抽取：708907 旧 Web 行为金样', () => {
  it('首次 create 恰好一次，固定 request ID、状态、输出及 scoped/legacy v3 指针', async () => {
    const run = options([stream(DONE)]);
    const opened = await openArenaGenerationStream(run.input);
    expect(await opened.text()).toBe(DONE);
    expect(run.calls).toEqual([createCall]);
    expect(run.states).toEqual(['connecting', 'generating', 'completed']);
    expect(opened.headers.get('X-Mahoshojo-Generation-Request-Id')).toBe(REQUEST_ID);
    expect(JSON.parse(run.storage.getItem(scopedKey)!)).toEqual(previous(3, { lastEventId: '3-0', state: 'completed' }));
    expect(run.storage.getItem(ARENA_GENERATION_CLIENT_STATE_KEY)).toBe(run.storage.getItem(scopedKey));
  });
  it('未知首包遇到 404/503 只查同 request，lookup 服务端 head 不作本地 cursor', async () => {
    const run = options([new TypeError('response lost'), new Response(null, { status: 404 }),
      new Response(null, { status: 503 }), lookup(), stream(DONE)]);
    expect(await (await openArenaGenerationStream(run.input)).text()).toBe(DONE);
    expect(run.calls).toEqual([createCall, lookupCall, lookupCall, lookupCall, resumeCall()]);
    expect(run.states).toEqual(['connecting', 'recovering_initial', 'resuming', 'resuming', 'completed']);
  });
  it('未知 create 在查询预算耗尽后为 unknown，不能第二次 POST', async () => {
    const run = options([new Response(null, { status: 503 }), new Response(null, { status: 404 }),
      new Response(null, { status: 404 })], { maxReconnectAttempts: 1 });
    await expect(openArenaGenerationStream(run.input)).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');
    expect(run.calls).toEqual([createCall, lookupCall, lookupCall]);
    expect(run.states).toEqual(['connecting', 'recovering_initial', 'unknown']);
  });
  it('断流仅重放完整块，cursor 去重/坏 ID/半包、snapshot、terminal 保持原轨迹', async () => {
    const first = 'id: 1-0\nevent: markdown\ndata: {"text":"A"}\n\n';
    const snapshot = 'id: 2-0\nevent: snapshot\ndata: {"markdown":"AB","status":"running"}\n\n';
    let pulled = false;
    const interrupted = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulled) { controller.error(new TypeError('disconnect')); return; }
      pulled = true;
      controller.enqueue(new TextEncoder().encode(`${first}id: 2-0\nevent: snapshot\ndata: {"markdown":`));
    } });
    const duplicate = 'id: 0001-000\nevent: markdown\ndata: {"text":"duplicate"}\n\n';
    const damaged = 'id: invalid-cursor\nevent: markdown\ndata: {"text":"invalid"}\n\n';
    const run = options([stream(interrupted), stream(duplicate + damaged + snapshot + DONE)]);
    expect(await (await openArenaGenerationStream(run.input)).text()).toBe(first + snapshot + DONE);
    expect(run.calls).toEqual([createCall, resumeCall('1-0')]);
    expect(run.states).toEqual(['connecting', 'generating', 'generating', 'reconnecting', 'resuming', 'generating', 'completed']);
    expect(readPersistedArenaGeneration(run.storage)?.lastEventId).toBe('3-0');
  });
  it('默认八次恢复和 500ms 指数退避固定，不产生第二次 create', async () => {
    vi.stubGlobal('crypto', undefined); // 使用同步 hash fallback，避免真实 WebCrypto 与虚拟时钟竞速
    vi.useFakeTimers();
    const run = options([new TypeError('response lost'),
      ...Array.from({ length: 9 }, () => new Response(null, { status: 404 }))],
    { maxReconnectAttempts: undefined, baseReconnectDelayMs: undefined });
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const result = openArenaGenerationStream(run.input);
    const rejection = expect(result).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');
    await vi.runAllTimersAsync();
    await rejection;
    expect(run.calls).toEqual([createCall, ...Array.from({ length: 9 }, () => lookupCall)]);
    expect(timer.mock.calls.map((call) => call[1])).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(run.states).toEqual(['connecting', 'recovering_initial', 'unknown']);
    timer.mockRestore();
  });
  it.each([
    ['done', 'cancelled', 'cancelled'],
    ['error', 'failed', 'failed'],
    ['error', 'producer_lost', 'producer_lost'],
  ] as const)('终态 %s/%s 保持 %s，不恢复也不 create', async (event, status, terminal) => {
    const wire = `id: 1-0\nevent: ${event}\ndata: {"status":"${status}"}\n\n`;
    const run = options([stream(wire)]);
    expect(await (await openArenaGenerationStream(run.input)).text()).toBe(wire);
    expect(run.calls).toEqual([createCall]);
    expect(run.states).toEqual(['connecting', 'generating', terminal]);
  });
  it('非终态 EOF 耗尽预算时保留正文并 interrupted', async () => {
    const text = 'id: 1-0\nevent: markdown\ndata: {"text":"保留"}\n\n';
    const run = options([stream(text)], { maxReconnectAttempts: 0 });
    expect(await (await openArenaGenerationStream(run.input)).text()).toBe(text);
    expect(run.calls).toEqual([createCall]);
    expect(run.states).toEqual(['connecting', 'generating', 'generating', 'interrupted']);
    expect(arenaGenerationConnectionNotice('interrupted')).toBe('战报连接恢复次数已耗尽；已接收正文会保留，但保存与恢复状态暂时无法确认。');
  });
  it.each([1, 2, 3] as const)('v%s body-scoped 旧状态恢复不 create，保留旧 cursor 与合法 pin 兼容', async (version) => {
    const run = options([stream(DONE)]);
    run.storage.setItem(scopedKey, JSON.stringify(previous(version)));
    expect(await (await openArenaGenerationStream(run.input)).text()).toBe(DONE);
    expect(run.calls).toEqual([resumeCall('2-0', version === 3 ? PIN : null)]);
    expect(run.states).toEqual(['resuming', 'resuming', 'resuming', 'completed']);
    expect(readPersistedArenaGeneration(run.storage)).toEqual(previous(3, {
      lastEventId: '3-0', state: 'completed', routePin: version === 3 ? PIN : null,
    }));
  });
  it.each([
    ['损坏 JSON', '{'],
    ['v3 pin 缺失', JSON.stringify({ ...previous(3), routePin: undefined })],
    ['v3 pin 非法', JSON.stringify(previous(3, { routePin: { placement: 'other' } }))],
    ['body 不匹配', JSON.stringify(previous(2, { bodyHash: 'other-body' }))],
    ['endpoint 不匹配', JSON.stringify(previous(2, { endpoint: '/other' }))],
  ])('%s 不误恢复另一个意图', async (_label, raw) => {
    const run = options([stream(DONE)]);
    run.storage.setItem(scopedKey, raw);
    expect(await (await openArenaGenerationStream(run.input)).text()).toBe(DONE);
    expect(run.calls).toEqual([createCall]);
  });
  it('legacy 全局指针不替代 endpoint/body-scoped 状态', async () => {
    const run = options([stream(DONE)]);
    run.storage.setItem(ARENA_GENERATION_CLIENT_STATE_KEY, JSON.stringify(previous(1)));
    await (await openArenaGenerationStream(run.input)).text();
    expect(run.calls).toEqual([createCall]);
  });
  it.each([[202, 'cancelled'], [409, 'cancel_unconfirmed'], [404, 'cancel_unconfirmed']] as const)(
    '显式 cancel %s 使用独立 intent、不带 read pin，结果为 %s', async (status, finalState) => {
      const controller = new AbortController();
      const run = options([stream(new ReadableStream<Uint8Array>()), new Response(null, { status })], { signal: controller.signal });
      const opened = await openArenaGenerationStream(run.input);
      controller.abort(STREAM_ABORT_REASON_USER);
      expect(await opened.text()).toBe('');
      expect(run.calls).toEqual([createCall, { method: 'POST', path: `/api/arena/generations/${GENERATION_ID}/cancel`,
        pin: null, body: { reason: 'user' } }]);
      expect(run.states).toEqual(['connecting', 'generating', 'cancelling', finalState]);
    },
  );
  it('预取消在未知 generation 时仅发 DELETE；404 仍是 cancel_unconfirmed', async () => {
    const controller = new AbortController();
    controller.abort(STREAM_ABORT_REASON_USER);
    const run = options([new Response(null, { status: 404 })], { signal: controller.signal });
    await expect(openArenaGenerationStream(run.input)).rejects.toThrow('ARENA_GENERATION_CANCELLED');
    expect(run.calls).toEqual([{ method: 'DELETE', path: ENDPOINT, pin: null,
      body: { generationRequestId: REQUEST_ID, reason: 'user' } }]);
    expect(run.states).toEqual(['connecting', 'cancelling', 'cancel_unconfirmed']);
  });
  it('普通 reader.cancel 只断订阅，之后的显式 abort 不再向服务端取消', async () => {
    const cancelled: unknown[] = [];
    const controller = new AbortController();
    const run = options([stream(new ReadableStream<Uint8Array>({ cancel(reason) { cancelled.push(reason); } }))], { signal: controller.signal });
    const opened = await openArenaGenerationStream(run.input);
    await opened.body!.getReader().cancel('navigation');
    controller.abort(STREAM_ABORT_REASON_USER);
    expect(cancelled).toEqual(['navigation']);
    expect(run.calls).toEqual([createCall]);
    expect(run.states).toEqual(['connecting', 'generating']);
  });
  it.each([
    ['local', undefined, ''],
    ['preview', hostedRouting.origins.preview, hostedRouting.origins.preview],
    ['production', undefined, hostedRouting.origins.primary],
  ] as const)('%s 合法路由贯穿 create 与独立 cancel，不触发 probe 或切到 DR', async (target, origin, prefix) => {
    Object.assign(honoApiConfig, resolveHostedApiConfig(origin, target));
    const wire: Array<{ path: string; method: string }> = [];
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      wire.push({ path, method: init?.method ?? 'GET' });
      return init?.method === 'POST' && path.endsWith(ENDPOINT)
        ? stream(new ReadableStream<Uint8Array>()) : new Response(null, { status: 202 });
    });
    const controller = new AbortController();
    const initialIntent = createGenerationApiIntent({ fetcher });
    const run = options([], { signal: controller.signal, getInitialRoutePin: initialIntent.getRoutePin,
      fetcher: async (path, init, pin, onPin) => {
        if (init?.method === 'GET' && pin) return createPinnedGenerationApiSafeReadDispatcher(pin, { fetcher }).dispatch(path, init);
        if (path === ENDPOINT && init?.method === 'POST') {
          const unsubscribe = initialIntent.subscribeRoutePinSelected((selected) => onPin?.(selected));
          try { return await initialIntent.dispatch(path, init); } finally { unsubscribe(); }
        }
        return createGenerationApiIntent({ fetcher }).dispatch(path, init);
      },
    });
    const opened = await openArenaGenerationStream(run.input);
    controller.abort(STREAM_ABORT_REASON_USER);
    await opened.text();
    expect(wire).toEqual([{ path: `${prefix}${ENDPOINT}`, method: 'POST' },
      { path: `${prefix}/api/arena/generations/${GENERATION_ID}/cancel`, method: 'POST' }]);
    expect(run.states).toEqual(['connecting', 'generating', 'cancelling', 'cancelled']);
  });
});
