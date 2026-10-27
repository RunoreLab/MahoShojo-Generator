// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveRandom: vi.fn(), quickCheck: vi.fn(), update: vi.fn(), appendHistory: vi.fn(), cooldown: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock('@/lib/client-route-adapter', () => ({ useClientRouteAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: mocks.cooldown, remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.quickCheck }));
vi.mock('@/lib/shield-word-filter', () => ({ applyShieldWords: (text: string) => ({ filteredText: text }) }));
vi.mock('@/components/arena/hooks/useBattleActions', () => ({ useBattleActions: () => ({ handleResolveRandomPlaceholders: mocks.resolveRandom }) }));
vi.mock('@/components/arena/hooks/useStreamCombatantUpdater', () => ({ useStreamCombatantUpdater: () => ({ updateFromMarkdown: mocks.update, retryGenerationUpdate: vi.fn() }) }));
vi.mock('@/lib/arena-room/narrative-history-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/arena-room/narrative-history-runtime')>(), appendArenaNarrativeHistoryResult: mocks.appendHistory,
}));
vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({ useArenaRoomContext: () => null }));

// Authentication, intent/latch, preflight, the Web wrapper and C0 are deliberately real.
import { authStorage } from '@/lib/auth';
import { AUTH_STORAGE_KEY } from '@/lib/auth-identity';
import { honoApiConfig } from '@/config/hono-api';
import { hostedDrClientRouting } from '@/config/hosted-routing';
import { HOSTED_DR_CLIENT_TELEMETRY_EVENT, type HostedDrClientTelemetryEvent } from '@/lib/hosted-dr/client-preflight-telemetry';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import { STREAM_READ_TOTAL_TIMEOUT_MS } from '@/lib/stream/timeout';
import { useBattleEngine } from '@/components/arena/hooks/useBattleEngine';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

const originalConfig = { ...honoApiConfig };
const a = { username: 'fixture-owner-a', userId: 101, authKey: 'synthetic-a', activityToken: 'synthetic-activity-a' };
const b = { username: 'fixture-owner-b', userId: 202, authKey: 'synthetic-b', activityToken: 'synthetic-activity-b' };
let rawA: string, rawB: string;
let current: ReturnType<typeof useBattleEngine>, root: Root, container: HTMLDivElement;
let business: ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;
let verify: ReturnType<typeof vi.fn<() => Promise<Response>>>;
let probe: ReturnType<typeof vi.fn<() => Promise<Response>>>;
let telemetry: HostedDrClientTelemetryEvent[];
const pendingReleases: Array<() => void> = [];
const collectTelemetry = (event: Event) => telemetry.push((event as CustomEvent<HostedDrClientTelemetryEvent>).detail);
const Harness = () => { const engine = useBattleEngine(); useEffect(() => { current = engine; }); return null; };
const deferred = <T,>() => {
  let resolve!: (_value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const switchIdentity = (raw: string) => {
  const oldValue = localStorage.getItem(AUTH_STORAGE_KEY);
  localStorage.setItem(AUTH_STORAGE_KEY, raw);
  window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue, newValue: raw, storageArea: localStorage }));
};
const ready = () => Response.json({
  ok: true, service: 'mahoshojo-hono', placement: 'hono-primary', contractVersion: hostedDrClientRouting.contractVersion,
}, { headers: { 'Cache-Control': 'no-store' } });
const stream = (body: string | ReadableStream<Uint8Array> | null, generationId = 'generation-owned-test') => new Response(body, {
  headers: { 'Content-Type': 'text/event-stream', 'X-Mahoshojo-Generation-Id': generationId },
});
const completed = () => stream('id: 1-0\nevent: markdown\ndata: {"chunk":"安全的完整故事"}\n\nid: 2-0\nevent: done\ndata: {"status":"completed","ok":true}\n\n');
const abortableCreate = (init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  const fail = () => reject(new DOMException('fixture aborted', 'AbortError'));
  pendingReleases.push(fail);
  if (init?.signal?.aborted) fail();
  else init?.signal?.addEventListener('abort', fail, { once: true });
});
const settlesSoon = async (task: Promise<void>) => {
  // A stale guard must abort its own C0 signal instead of entering its retry budget.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('identity-invalid request entered recovery backoff')), 500);
    })]);
  } finally { clearTimeout(timer); }
};
const expectOwnerA = (init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  expect(headers.get('Authorization')).toBe('Bearer synthetic-a');
  expect(headers.get('x-mahoshojo-user-id')).toBe('101');
  expect(headers.get('x-mahoshojo-activity-token')).toBe('synthetic-activity-a');
};

beforeEach(async () => {
  mocks.cooldown.mockClear();
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear(); sessionStorage.clear();
  await authStorage.setAuth(b); rawB = localStorage.getItem(AUTH_STORAGE_KEY)!;
  await authStorage.setAuth(a); rawA = localStorage.getItem(AUTH_STORAGE_KEY)!;
  mocks.resolveRandom.mockResolvedValue(undefined);
  mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false, matchDetails: [], detectedWords: [] });
  mocks.update.mockResolvedValue(undefined);
  probe = vi.fn(async () => ready());
  verify = vi.fn(async () => { throw new Error('unexpected session bootstrap'); });
  business = vi.fn(async () => completed());
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === '/api/auth/verify') return verify();
    if (url === '/api/telemetry/hosted-dr') return new Response(null, { status: 204 });
    if (url.endsWith('/api/health/ready')) return probe();
    return business(url, init);
  }));
  Object.assign(honoApiConfig, { enabled: true, routingMode: 'client-preflight', origin: hostedDrClientRouting.primaryOrigin });
  telemetry = []; window.addEventListener(HOSTED_DR_CLIENT_TELEMETRY_EVENT, collectTelemetry);
  const initial = useBattleStore.getInitialState();
  useBattleStore.setState({ ...initial, reportFormat: 'markdown', generationMode: 'stream', battleMode: 'daily',
    combatants: [{ type: 'general-character', filename: 'test.json', data: { name: '角色甲' }, isValid: false, isPreset: false }],
    settings: { ...initial.settings, writeArenaHistory: false, writeCurrentState: false, writeNarrativeHistory: false },
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  pendingReleases.splice(0).forEach((release) => release());
  await act(async () => root.unmount()); container.remove();
  window.removeEventListener(HOSTED_DR_CLIENT_TELEMETRY_EVENT, collectTelemetry);
  vi.restoreAllMocks();
  authStorage.clearAuth();
  useBattleStore.setState(useBattleStore.getInitialState());
  Object.assign(honoApiConfig, originalConfig);
  vi.unstubAllGlobals();
});

describe('BattleEngine real auth → intent → C0 ownership boundary', () => {
  it.each(['stream', 'non-stream'] as const)('captures identity before %s asynchronous character preparation', async (generationMode) => {
    await act(async () => useBattleStore.setState({ generationMode }));
    const entered = deferred<void>(); const gate = deferred<void>();
    mocks.resolveRandom.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; });
    await act(async () => { switchIdentity(rawB); gate.resolve(); await task; });
    expect(business).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });

  it('does not downgrade a switched account to anonymous after actual header decryption', async () => {
    await authStorage.setAuth(b); switchIdentity(rawA);
    const entered = deferred<void>(); const gate = deferred<void>();
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
      entered.resolve(); await gate.promise; return decrypt(...args);
    });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; });
    await act(async () => { switchIdentity(rawB); gate.resolve(); await task; });
    expect(business).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
    expect(await authStorage.getAuth()).toMatchObject(b);
  });

  it('accepts legitimate cookie bootstrap and dispatches all headers from the verified identity', async () => {
    authStorage.clearAuth();
    verify.mockResolvedValueOnce(Response.json({ success: true, authSource: 'better-auth-session', authKey: a.authKey,
      user: { id: a.userId, username: a.username }, activityToken: a.activityToken }));
    await act(async () => current.handleGenerate());
    expect(verify).toHaveBeenCalledOnce(); expect(business).toHaveBeenCalledOnce();
    expectOwnerA(business.mock.calls[0]?.[1]);
    expect(useBattleStore.getState().streamingMarkdown).toBe('安全的完整故事');
    expect(useBattleStore.getState().error).toBeFalsy();
  });

  it('rejects a switch after placement before business fetch and leaves the latch usable by the new account', async () => {
    const changeAfterSelection = (event: Event) => {
      if ((event as CustomEvent<HostedDrClientTelemetryEvent>).detail.phase !== 'selection') return;
      window.removeEventListener(HOSTED_DR_CLIENT_TELEMETRY_EVENT, changeAfterSelection);
      switchIdentity(rawB);
    };
    window.addEventListener(HOSTED_DR_CLIENT_TELEMETRY_EVENT, changeAfterSelection);
    try { await act(async () => settlesSoon(current.handleGenerate())); }
    finally { window.removeEventListener(HOSTED_DR_CLIENT_TELEMETRY_EVENT, changeAfterSelection); }
    expect(business).not.toHaveBeenCalled();
    expect(telemetry.filter((event) => event.phase === 'dispatch-terminal')).toEqual([
      expect.objectContaining({ terminalClass: 'not-dispatched' }),
    ]);
    await act(async () => current.handleGenerate());
    expect(business).toHaveBeenCalledOnce();
    expect(new Headers(business.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-b');
  });

  it.each(['lookup', 'resume'] as const)('invalidates C0 %s without a retry delay or an unauthorized read/cancel', async (recovery) => {
    let signal: AbortSignal | undefined;
    business.mockImplementationOnce(async (_input, init) => {
      signal = init?.signal ?? undefined;
      expectOwnerA(init);
      switchIdentity(rawB);
      if (recovery === 'lookup') throw new TypeError('fixture create headers lost');
      return stream(null);
    });
    await act(async () => settlesSoon(current.handleGenerate()));
    expect(business).toHaveBeenCalledOnce();
    expect(business.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).not.toBe(STREAM_ABORT_REASON_USER);
    expect(signal?.reason).toBe('auth-identity-changed');
    // Arena create is primary-only; recovery must keep its selected pin without probing.
    expect(probe).not.toHaveBeenCalled();
  });

  it.each(['pending-create', 'active-stream'] as const)('blocks a switched identity from %s USER cancellation', async (stage) => {
    const entered = deferred<void>();
    business.mockImplementationOnce(async (_input, init) => {
      entered.resolve();
      return stage === 'pending-create' ? abortableCreate(init) : stream(new ReadableStream({ start() {} }));
    });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; });
    if (stage === 'active-stream') await act(async () => { await vi.waitFor(() => expect(useBattleStore.getState().arenaGenerationConnectionState).toBe('generating')); });
    await act(async () => { switchIdentity(rawB); current.stopGeneration(); await settlesSoon(task); });
    expect(business).toHaveBeenCalledOnce();
    expect(business.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
    expect(useBattleStore.getState().arenaGenerationConnectionState).toBeNull();
    business.mockResolvedValueOnce(completed());
    await act(async () => { await current.handleGenerate(); });
    // The old actor's request cannot be cancelled under the new identity.
    // Its persisted uncertainty remains actionable through the risk decision.
    expect(useBattleStore.getState().arenaGenerationConnectionState).toBe('cancel_unconfirmed');
    expect(business).toHaveBeenCalledOnce();
    await act(async () => { await current.confirmGenerateAfterUnconfirmedCancel(); });
    expect(business).toHaveBeenCalledTimes(2);
    expect(business.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
    expect(new Headers(business.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer synthetic-b');
    expect(JSON.parse(String(business.mock.calls[1][1]?.body)).generationRequestId)
      .not.toBe(JSON.parse(String(business.mock.calls[0][1]?.body)).generationRequestId);
  });

  it.each(['pending-create', 'active-stream'] as const)('same-owner USER cancellation still dispatches from %s with the original headers', async (stage) => {
    const entered = deferred<void>();
    business.mockImplementation(async (input, init) => {
      if (init?.method === 'DELETE' || input.endsWith('/cancel')) return new Response(null, { status: 202 });
      entered.resolve();
      return stage === 'pending-create' ? abortableCreate(init) : stream(new ReadableStream({ start() {} }));
    });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; });
    if (stage === 'active-stream') await act(async () => { await vi.waitFor(() => expect(useBattleStore.getState().arenaGenerationConnectionState).toBe('generating')); });
    await act(async () => { current.stopGeneration(); await settlesSoon(task); });
    expect(business).toHaveBeenCalledTimes(2);
    const [url, init] = business.mock.calls[1]!;
    expect(init?.method).toBe(stage === 'pending-create' ? 'DELETE' : 'POST');
    expect(url).toContain(stage === 'pending-create' ? '/api/arena/generate-stream' : '/api/arena/generations/generation-owned-test/cancel');
    expectOwnerA(init);
    expect(init?.signal?.aborted).toBe(false);
    expect(JSON.parse(String(init?.body))).toMatchObject({ reason: 'user' });
  });

  it('does not let a stale pending stream timeout write a warning into the next account', async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    business.mockImplementationOnce(async () => { entered.resolve(); return stream(new ReadableStream({ start() {} })); });
    let task!: Promise<void>;
    try {
      await act(async () => {
        task = current.handleGenerate(); await entered.promise;
        await vi.waitFor(() => expect(useBattleStore.getState().isStreaming).toBe(true));
      });
      await act(async () => {
        switchIdentity(rawB);
        await vi.advanceTimersByTimeAsync(STREAM_READ_TOTAL_TIMEOUT_MS + 1);
      });
      expect(useBattleStore.getState().streamSoftTimeoutWarning).toBeNull();
      expect(business).toHaveBeenCalledOnce();
      await act(async () => { current.stopGeneration(); await task; });
    } finally { vi.useRealTimers(); }
  });

  it('stops locally immediately, gates a second create until acknowledgement, and ignores old cleanup', async () => {
    const firstEntered = deferred<void>(), secondEntered = deferred<void>(), firstCancelEntered = deferred<void>();
    const cancelGate = deferred<Response>();
    let creates = 0, cancels = 0;
    business.mockImplementation(async (_input, init) => {
      if (init?.method === 'DELETE') {
        cancels += 1;
        if (cancels === 1) { firstCancelEntered.resolve(); return cancelGate.promise; }
        return new Response(null, { status: 202 });
      }
      creates += 1;
      (creates === 1 ? firstEntered : secondEntered).resolve();
      return abortableCreate(init);
    });
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = current.handleGenerate(); await firstEntered.promise; });
    await act(async () => {
      current.stopGeneration();
      expect(useBattleStore.getState()).toMatchObject({ isGenerating: false, isStreaming: false,
        arenaGenerationConnectionState: 'cancelling' });
      await current.handleGenerate();
      await settlesSoon(Promise.all([first, firstCancelEntered.promise]).then(() => undefined));
    });
    expect(creates).toBe(1);
    await act(async () => { cancelGate.resolve(new Response(null, { status: 202 })); await settlesSoon(first); });
    await act(async () => {
      await vi.waitFor(() => expect(useBattleStore.getState().arenaGenerationConnectionState).toBe('cancelled'));
      second = current.handleGenerate(); await secondEntered.promise;
    });
    await act(async () => { current.stopGeneration(); await settlesSoon(second); });
    expect(creates).toBe(2); expect(cancels).toBe(2);
    for (const [, init] of business.mock.calls) expectOwnerA(init);
    expect(business.mock.calls.filter(([, init]) => init?.method === 'POST').every(([, init]) => init?.signal?.reason === STREAM_ABORT_REASON_USER)).toBe(true);
  });

  it('keeps partial text and requires an explicit risk decision after an unconfirmed cancel', async () => {
    const entered = deferred<void>();
    business.mockImplementationOnce(async () => {
      entered.resolve();
      return stream(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('id: 1-0\nevent: markdown\ndata: {"chunk":"停止前的正文"}\n\n'));
      } }));
    }).mockResolvedValueOnce(new Response(null, { status: 503 }));
    let task!: Promise<void>;
    await act(async () => {
      task = current.handleGenerate(); await entered.promise;
      await vi.waitFor(() => expect(useBattleStore.getState().streamingMarkdown).toBe('停止前的正文'));
      current.stopGeneration(); await settlesSoon(task);
      await vi.waitFor(() => expect(useBattleStore.getState().arenaGenerationConnectionState).toBe('cancel_unconfirmed'));
    });
    expect(useBattleStore.getState()).toMatchObject({ isGenerating: false, isStreaming: false,
      streamingMarkdown: '停止前的正文' });
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => { await current.handleGenerate(); });
    expect(business).toHaveBeenCalledTimes(2);
    const cancelledRequestId = useBattleStore.getState().arenaGenerationCancellationRequestId;
    // Simulate a reload losing transient Zustand state while sessionStorage survives.
    await act(async () => { useBattleStore.getState().setArenaGenerationConnectionState(null);
      await current.handleGenerate(); });
    expect(business).toHaveBeenCalledTimes(2);
    expect(useBattleStore.getState()).toMatchObject({ isGenerating: false,
      arenaGenerationConnectionState: 'cancel_unconfirmed', arenaGenerationCancellationRequestId: cancelledRequestId });
    business.mockResolvedValueOnce(completed());
    await act(async () => { await current.confirmGenerateAfterUnconfirmedCancel(); });
    expect(business).toHaveBeenCalledTimes(3);
    expect(useBattleStore.getState().streamingMarkdown).toBe('安全的完整故事');
  });

  it('superseding an active stream still cancels the old producer and keeps the replacement stoppable', async () => {
    let creates = 0;
    business.mockImplementation(async (url, init) => {
      if (url.endsWith('/cancel')) return new Response(null, { status: 202 });
      creates += 1;
      return stream(new ReadableStream(), `generation-owned-${creates}`);
    });
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => {
      first = current.handleGenerate();
      await vi.waitFor(() => expect(useBattleStore.getState().isStreaming).toBe(true));
      second = current.handleGenerate(); await settlesSoon(first);
      await vi.waitFor(() => expect(creates).toBe(2));
      await vi.waitFor(() => expect(useBattleStore.getState().isStreaming).toBe(true));
    });
    expect(business.mock.calls[0][1]?.signal?.reason).toBe(STREAM_ABORT_REASON_USER);
    await act(async () => { current.stopGeneration(); await settlesSoon(second); });
    await vi.waitFor(() => expect(business.mock.calls.filter(([url]) => url.endsWith('/cancel'))).toHaveLength(2));
    expect(business.mock.calls.filter(([url]) => url.endsWith('/cancel')).map(([url]) => url)).toEqual([
      expect.stringContaining('/generation-owned-1/cancel'), expect.stringContaining('/generation-owned-2/cancel'),
    ]);
  });

  it('does not retain a cancellation gate after the account changes during confirmation', async () => {
    const entered = deferred<void>(), cancelEntered = deferred<void>(), receipt = deferred<Response>();
    business.mockImplementationOnce(async (_url, init) => { entered.resolve(); return abortableCreate(init); })
      .mockImplementationOnce(async () => { cancelEntered.resolve(); return receipt.promise; });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; current.stopGeneration();
      await settlesSoon(task); await cancelEntered.promise; switchIdentity(rawB); });
    await act(async () => { receipt.resolve(new Response(null, { status: 202 }));
      await vi.waitFor(() => expect(useBattleStore.getState().arenaGenerationConnectionState).toBeNull()); });
    business.mockResolvedValueOnce(completed());
    await act(async () => { await current.handleGenerate(); });
    expect(business).toHaveBeenCalledTimes(3);
  });

  it('stopping local work after a terminal event does not wait for an unnecessary cancellation', async () => {
    await act(async () => useBattleStore.setState({ settings: {
      ...useBattleStore.getState().settings, writeArenaHistory: true,
    } }));
    const entered = deferred<void>(), gate = deferred<void>();
    mocks.update.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; current.stopGeneration(); });
    expect(useBattleStore.getState()).toMatchObject({ isGenerating: false, isStreaming: false,
      arenaGenerationConnectionState: null });
    await act(async () => { gate.resolve(); await task; });
    expect(business).toHaveBeenCalledOnce();
  });

  it.each([
    ['system', 20_000, 100_000], ['system', 130_000, 0], ['custom', 1_000, 2_000], ['custom', 4_000, 0],
  ] as const)('manual stop uses only remaining %s cooldown after %i ms', async (mode, elapsed, remaining) => {
    if (mode === 'custom') await act(async () => useBattleStore.setState({
      userProviderConfig: { providerId: 'kourichat', modelId: 'gemini-2.5-flash', apiKey: 'synthetic-key' },
    }));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const entered = deferred<void>();
    business.mockImplementationOnce(async (_input, init) => { entered.resolve(); return abortableCreate(init); })
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; });
    clock.mockReturnValue(1_000_000 + elapsed);
    await act(async () => { current.stopGeneration(); await settlesSoon(task); });
    expect(mocks.cooldown).toHaveBeenCalledExactlyOnceWith(remaining);
  });

  it('stops during asynchronous preparation without sending a request or starting cooldown', async () => {
    const entered = deferred<void>(), gate = deferred<void>();
    mocks.resolveRandom.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    let task!: Promise<void>;
    await act(async () => { task = current.handleGenerate(); await entered.promise; current.stopGeneration(); });
    expect(useBattleStore.getState()).toMatchObject({ isGenerating: false, isStreaming: false,
      arenaGenerationConnectionState: null });
    await act(async () => { gate.resolve(); await task; });
    expect(business).not.toHaveBeenCalled();
    expect(mocks.cooldown).not.toHaveBeenCalled();
  });
});
