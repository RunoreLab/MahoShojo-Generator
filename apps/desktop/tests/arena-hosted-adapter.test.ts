import { describe, expect, it, vi } from 'vitest';
import { buildArenaGenerationInputSnapshot, type ArenaGenerationInputSnapshot } from '@mahoshojo/ai-core/arena-generation';
import {
  DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION, DesktopArenaHostedChannelEventSchema, DesktopArenaHostedControlRequestSchema,
  DesktopArenaHostedControlResponseSchema, DesktopArenaHostedRecoveryPointerSchema, DesktopArenaHostedSseEventSchema, DesktopArenaHostedStreamRequestSchema,
  type DesktopArenaHostedActor, type DesktopArenaHostedControlRequest, type DesktopArenaHostedControlResponse,
  type DesktopArenaHostedRecoveryPointer, type DesktopArenaHostedSseEvent, type DesktopArenaHostedStreamRequest,
} from '@mahoshojo/contracts/desktop-arena-hosted';
import { createWebPackageOverlayFromBase, digestWebPackageBytes, verifyWebPackage, type ResolvedWebPackage } from '@mahoshojo/web-package';
import {
  ARENA_HOSTED_DETACH, ARENA_HOSTED_USER_STOP, executeArenaHosted, resumeArenaHosted,
  type ArenaHostedContext, type ArenaHostedIntent, type ArenaHostedPartial,
} from '../src/features/arena/hosted';
import { ARENA_HOSTED_RECOVERY_KEYS, DesktopArenaHostedRecovery } from '../src/features/arena/hosted-recovery';
import {
  ARENA_HOSTED_CONTROL_COMMAND, ARENA_HOSTED_DETACH_COMMAND, ARENA_HOSTED_STREAM_COMMAND,
  type ArenaHostedChannel, type ArenaHostedHandshake,
} from '../src/platform/arena-hosted-bridge';

// Only the Native boundary is synthetic. The adapter, C0 client, bridge and validators are real.
const requestId = 'arena_adapter_request_1234';
const generationId = `arena_${'a'.repeat(64)}`;
const now = '2026-10-10T05:00:00.000Z';
const source = '# 相遇\n\n完整保留的故事';
const freeWeb = '<!doctype html><html><head><title>相遇</title></head><body>完整故事</body></html>';
const input = (battleMode: ArenaGenerationInputSnapshot['battleMode'] = 'classic', reportFormat: 'markdown' | 'web' = 'markdown'): ArenaGenerationInputSnapshot => ({
  battleMode, reportFormat, arenaFreeRankingEnabled: false,
  combatants: ['甲', '乙'].map(name => ({ type: 'general-character', data: { name, content: '完整角色设定', signature: 'source-signature' }, isValid: true, isPreset: false, filename: '' })),
  teams: [], scenario: { content: battleMode === 'scenario' ? { title: '车站', content: '等待重逢' } : null, fileName: null },
  scenarioDisplayName: '车站', auxScenarios: [], materials: [], selectedLanguage: 'zh-CN',
  settings: { userGuidance: '守护彼此', readArenaHistory: true, readArenaHistoryLimit: 3, isArenaHistoryUnlimited: false, writeArenaHistory: true,
    readCurrentState: true, writeCurrentState: true, readNarrativeHistory: true, readNarrativeHistoryLimit: 3, isNarrativeHistoryUnlimited: false, writeNarrativeHistory: true },
  narrativeHistoryEntries: [], adjudicationEvents: [{ type: 'binary', description: '只交服务器物化一次', probability: 37 }], storyLength: 'medium',
});
const intent = (funding: 'system' | 'preset' = 'system'): ArenaHostedIntent => ({
  requestId, mode: 'hosted', generationMode: 'stream', modelId: 'deepseek-chat',
  ...(funding === 'system' ? { systemConfig: { modelId: 'deepseek-chat' } } : { presetConfig: { providerId: 'deepseek', modelId: 'deepseek-chat' } }),
});
const event = (id: string, event: string, data: unknown): DesktopArenaHostedSseEvent => DesktopArenaHostedSseEventSchema.parse({ id, event, data });
const textEvent = (chunk = source, id = '1-0') => event(id, 'markdown', { chunk });
const doneEvent = (id = '2-0', extra: Record<string, unknown> = {}) => event(id, 'done', { ok: true, status: 'completed', ...extra });
const lookupReply = (status = 200): DesktopArenaHostedControlResponse => DesktopArenaHostedControlResponseSchema.parse({
  status, body: status === 200 ? { generationId, generationRequestId: requestId, status: 'running' }
    : { code: status === 404 ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE' }, recoveryCredentialState: 'stored',
});
const pointer = (patch: Partial<DesktopArenaHostedRecoveryPointer> = {}): DesktopArenaHostedRecoveryPointer => DesktopArenaHostedRecoveryPointerSchema.parse({
  version: 1, protocolVersion: DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION, product: 'battle', requestId,
  generationId, cursor: '99-0', bodyHash: 'b'.repeat(64), actor: { kind: 'anonymous' },
  format: 'markdown', battleMode: 'classic', state: 'cancel_unconfirmed', updatedAt: now, ...patch,
});
function storage(initial?: DesktopArenaHostedRecoveryPointer) {
  const values = new Map<string, string>();
  if (initial) values.set(ARENA_HOSTED_RECOVERY_KEYS[initial.product], JSON.stringify(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: (key: string) => { values.delete(key); } };
}
function context(overrides: Partial<ArenaHostedContext> = {}, initial?: DesktopArenaHostedRecoveryPointer) {
  const store = storage(initial);
  const host: ArenaHostedContext = { product: initial?.product ?? 'battle', scopeKey: 'account-A:epoch-1', actor: initial?.actor ?? { kind: 'anonymous' },
    recovery: new DesktopArenaHostedRecovery(store, overrides.product ?? initial?.product ?? 'battle'), now: () => now,
    wait: async () => undefined, maxReconnectAttempts: 2, createChannel: () => ({ onmessage: () => undefined }), ...overrides };
  return { host, store };
}
interface Peer {
  request: DesktopArenaHostedStreamRequest;
  response(patch?: Partial<ArenaHostedHandshake>): void;
  emit(value: DesktopArenaHostedSseEvent, split?: number): void;
  end(): void;
}
type StreamStep = (peer: Peer) => void | Promise<void>;
function native(streams: StreamStep[], control: (request: DesktopArenaHostedControlRequest, index: number) => DesktopArenaHostedControlResponse | Promise<DesktopArenaHostedControlResponse> = () => lookupReply()) {
  const streamRequests: DesktopArenaHostedStreamRequest[] = [], controlRequests: DesktopArenaHostedControlRequest[] = [], peers: Peer[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === ARENA_HOSTED_DETACH_COMMAND) return;
    if (command === ARENA_HOSTED_CONTROL_COMMAND) {
      const request = DesktopArenaHostedControlRequestSchema.parse(args?.request); controlRequests.push(request);
      return DesktopArenaHostedControlResponseSchema.parse(await control(request, controlRequests.length - 1));
    }
    if (command !== ARENA_HOSTED_STREAM_COMMAND) throw new Error(`Unexpected command: ${command}`);
    const request = DesktopArenaHostedStreamRequestSchema.parse(args?.request); streamRequests.push(request);
    const channel = args?.onEvent as ArenaHostedChannel; let sequence = 0;
    const send = (value: Record<string, unknown>) => channel.onmessage(DesktopArenaHostedChannelEventSchema.parse({ requestId: request.requestId, sequence: sequence++, ...value }));
    const peer: Peer = { request,
      response: patch => send({ kind: 'response', status: 200, generationId, generationRequestId: request.requestId,
        metadataState: 'missing', recoveryCredentialState: 'stored', ...patch }),
      emit: (value, split) => {
        const checked = DesktopArenaHostedSseEventSchema.parse(value);
        const wire = `id: ${checked.id}\nevent: ${checked.event}\ndata: ${JSON.stringify(checked.data)}\n\n`;
        const size = split ?? 16_000;
        for (let offset = 0; offset < wire.length; offset += size) send({ kind: 'sse-fragment', text: wire.slice(offset, offset + size), final: offset + size >= wire.length });
      }, end: () => send({ kind: 'stream-end' }),
    };
    peers.push(peer); const step = streams[streamRequests.length - 1];
    if (!step) throw new Error('Unexpected extra create/resume');
    await step(peer);
  });
  return { invoke, streamRequests, controlRequests, peers };
}
const complete = (text = source, extra: Record<string, unknown> = {}): StreamStep => peer => {
  peer.response(); peer.emit(textEvent(text), 17); peer.emit(doneEvent('2-0', extra)); peer.end();
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const execute = (h: ReturnType<typeof native>, host: ArenaHostedContext, value = input(), task = intent(), signal = new AbortController().signal,
  onPartial?: (partial: ArenaHostedPartial) => void) => executeArenaHosted({ invoke: h.invoke }, value, task, host, signal, onPartial);
async function packageBase(target = 'data/report.json', mediaType = 'application/json'): Promise<ResolvedWebPackage> {
  const sources = [
    { path: 'index.html', mediaType: 'text/html', text: '<!doctype html><html><body>base</body></html>' },
    { path: 'schema.json', mediaType: 'application/json', text: JSON.stringify({ type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string' } } }) },
    { path: 'ai/instructions.md', mediaType: 'text/markdown', text: '完整保留角色，只替换指定目标。' },
  ];
  const files = sources.map(file => ({ ...file, bytes: new TextEncoder().encode(file.text) }));
  return verifyWebPackage({ format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.hosted-adapter', version: '1.0.0', name: '适配器夹具', entry: 'index.html',
    generation: { target, mediaType, mode: 'replace', instructions: 'ai/instructions.md', ...(mediaType === 'application/json' ? { schema: 'schema.json' } : {}) },
    files: await Promise.all(files.map(async file => ({ path: file.path, mediaType: file.mediaType, size: file.bytes.length, digest: await digestWebPackageBytes(file.bytes) }))),
  }, files);
}
const combinations = (['classic', 'kizuna', 'daily', 'scenario'] as const).flatMap(mode => (['markdown', 'web'] as const).map(format => ({ mode, format })));

describe('Desktop Hosted adapter through real C0 and Native bridge', () => {
  it.each(combinations)('$mode / $format keeps one create and the independent pointer across product/funding/actor combinations', async ({ mode, format }) => {
    for (const product of ['battle', 'arena'] as const) for (const funding of ['system', 'preset'] as const) for (const actor of [{ kind: 'anonymous' }, { kind: 'account', expectedUserId: 42 }] satisfies DesktopArenaHostedActor[]) {
      const { host, store } = context({ product, actor }); const value = input(mode, format); const original = structuredClone(value);
      const h = native([peer => {
        const saved = JSON.parse(store.values.get(ARENA_HOSTED_RECOVERY_KEYS[product])!);
        expect(saved).toMatchObject({ requestId, actor, product }); expect(saved).not.toHaveProperty('body');
        complete(format === 'web' ? freeWeb : source)(peer);
      }]);
      const result = await execute(h, host, value, intent(funding));
      expect(result).toMatchObject({ status: 'completed', generationId, requestId, scopeKey: host.scopeKey,
        markdown: format === 'web' ? freeWeb : source, canAppendHistory: true,
        hosted: { metadataState: 'missing', serverStatus: 'completed', outputValidation: 'valid', restored: false },
        report: { officialReport: { winner: '' }, reporterInfo: { name: '', publication: '' } } });
      expect(value).toEqual(original); expect(h.streamRequests).toHaveLength(1); expect(h.controlRequests).toHaveLength(0);
      expect(h.streamRequests[0]).toMatchObject({ operation: 'create-stream', product, actor,
        body: JSON.parse(JSON.stringify(buildArenaGenerationInputSnapshot({ ...original, settings: { ...original.settings } }))),
        ...(funding === 'system' ? { systemConfig: intent().systemConfig } : { presetConfig: intent('preset').presetConfig }) });
      expect(h.streamRequests[0]).not.toHaveProperty('body.adjudicationResults');
      for (const field of ['updatedCombatants', 'impacts', 'signature']) expect(result).not.toHaveProperty(field);
      expect(host.recovery.getSnapshot().pointer).toMatchObject({ generationId, cursor: '2-0', state: 'completed' });
      expect(h.invoke.mock.calls.every(([command]) => command === ARENA_HOSTED_STREAM_COMMAND || command === ARENA_HOSTED_DETACH_COMMAND)).toBe(true);
    }
  });
  it('freezes input, funding, product, actor and scope before the first asynchronous preparation', async () => {
    const { host } = context(); const value = input(); const task = intent('preset'); const h = native([complete()]);
    const pending = execute(h, host, value, task);
    value.combatants[0]!.data.name = '后来的角色'; task.modelId = 'changed'; task.presetConfig!.modelId = 'changed';
    host.scopeKey = 'account-B:epoch-2'; host.product = 'arena'; host.actor = { kind: 'account', expectedUserId: 99 };
    const result = await pending;
    expect(result).toMatchObject({ status: 'completed', scopeKey: 'account-A:epoch-1' });
    expect(h.streamRequests[0]).toMatchObject({ product: 'battle', actor: { kind: 'anonymous' }, presetConfig: { modelId: 'deepseek-chat' } });
    expect(JSON.stringify(h.streamRequests[0])).toContain('甲'); expect(JSON.stringify(h.streamRequests[0])).not.toContain('后来的角色');
  });
  it.each(['正文没有 HTML 文档', '<!doctype html><html><body>尚未闭合'])('free-Web framing remains separate from server completion and never opens a run port: %s', async content => {
    const { host } = context(); const h = native([complete(content)]);
    expect(await execute(h, host, input('daily', 'web'))).toMatchObject({ status: 'completed', markdown: content, hosted: { serverStatus: 'completed' } });
    expect(h.invoke.mock.calls.every(([command]) => command === ARENA_HOSTED_STREAM_COMMAND || command === ARENA_HOSTED_DETACH_COMMAND)).toBe(true);
  });
  it('fails before all IPC when independent pointer persistence fails', async () => {
    const { host, store } = context(); store.setItem.mockImplementation(() => { throw new Error('synthetic full storage'); }); const h = native([complete()]);
    await expect(execute(h, host)).rejects.toThrow('恢复指针');
    expect(h.invoke).not.toHaveBeenCalled(); expect(host.recovery.getSnapshot()).toMatchObject({ saved: false, pointer: null });
  });
  it('never creates twice for the same persisted request', async () => {
    const { host } = context(); const h = native([complete()]); expect((await execute(h, host)).status).toBe('completed');
    await expect(execute(h, host)).rejects.toThrow('不重新创建'); expect(h.streamRequests.map(request => request.operation)).toEqual(['create-stream']);
  });
  it('unknown first POST uses 404/503 lookup then resume, with no re-POST or control funding', async () => {
    const { host } = context(); const h = native([() => { throw new Error('synthetic first response lost'); }, complete()], (_request, index) => lookupReply(index === 0 ? 404 : index === 1 ? 503 : 200));
    expect(await execute(h, host, input(), intent('preset'))).toMatchObject({ status: 'completed', markdown: source });
    expect(h.streamRequests.map(request => request.operation)).toEqual(['create-stream', 'resume']); expect(h.controlRequests).toHaveLength(3);
    for (const request of h.controlRequests) expect(request).toEqual({ operation: 'lookup-request', product: 'battle', requestId, actor: host.actor });
    expect(h.streamRequests[1]).toEqual({ operation: 'resume', product: 'battle', requestId, actor: host.actor, generationId });
  });
  it('a proven capability failure never becomes an ambiguous POST or lookup', async () => {
    const { host } = context(); const h = native([() => { throw { code: 'capability-unavailable', dispatchState: 'not-dispatched', intentOwnership: 'current-owned', message: 'synthetic-secret-canary' }; }]);
    const result = await execute(h, host); expect(result.status).toBe('failed'); expect(JSON.stringify(result)).not.toContain('synthetic-secret-canary');
    expect(h.controlRequests).toHaveLength(0); expect(h.streamRequests).toHaveLength(1);
  });
  it.each(['prepared', 'completed', 'cancel_unconfirmed', 'cancelled', 'producer_lost'] as const)('fresh explicit %s recovery first restores the original session and ignores the old cursor', async state => {
    const old = pointer({ state }); const { host } = context({}, old); const h = native([complete()]);
    const result = await resumeArenaHosted({ invoke: h.invoke }, host.recovery.acceptRestore(requestId)!, host, new AbortController().signal);
    expect(result).toMatchObject({ status: 'completed', markdown: source, canAppendHistory: false, hosted: { restored: true } });
    expect(h.controlRequests).toEqual([{ operation: 'lookup-request', product: old.product, requestId, actor: old.actor, restoreSession: true }]);
    expect(h.streamRequests).toEqual([{ operation: 'resume', product: old.product, requestId, actor: old.actor, generationId }]);
    expect(h.invoke.mock.calls.map(([command]) => command).slice(0, 2)).toEqual([ARENA_HOSTED_CONTROL_COMMAND, ARENA_HOSTED_STREAM_COMMAND]);
  });
  it('failed fresh recovery cannot create, replace identity or repeat explicit session restore', async () => {
    const old = pointer({ generationId: undefined, state: 'unknown' }); const { host } = context({}, old); const h = native([], () => lookupReply(404));
    const result = await resumeArenaHosted({ invoke: h.invoke }, old, host, new AbortController().signal);
    expect(result.status).toBe('failed'); expect(h.streamRequests).toHaveLength(0); expect(h.controlRequests).toHaveLength(3);
    expect(h.controlRequests[0]).toMatchObject({ restoreSession: true }); expect(h.controlRequests.slice(1).every(request => !('restoreSession' in request))).toBe(true);
    expect(host.recovery.getSnapshot().pointer?.requestId).toBe(requestId);
  });
  it('hot reconnect deduplicates event IDs and replaces snapshots instead of appending', async () => {
    const { host } = context(); const partials: ArenaHostedPartial[] = [];
    const h = native([peer => {
      peer.response(); peer.emit(textEvent('旧正文', '1-0')); peer.emit(event('2-0', 'reasoning', { chunk: '旧推理' }));
      peer.emit(event('3-0', 'telemetry', { usage: { totalTokens: 10 } })); peer.end();
    }, peer => {
      peer.response(); peer.emit(textEvent('绝不能重复追加', '1-0'));
      peer.emit(event('4-0', 'snapshot', { status: 'running', markdown: '快照正文', reasoning: '快照推理', lastEventId: '4-0', updatedAt: now, telemetry: { usage: { totalTokens: 20 } } }));
      peer.emit(textEvent('结尾', '5-0')); peer.emit(textEvent('绝不能重复追加', '5-0')); peer.emit(doneEvent('6-0')); peer.end();
    }]);
    const result = await execute(h, host, input(), intent(), new AbortController().signal, partial => partials.push(partial));
    expect(result).toMatchObject({ status: 'completed', markdown: '快照正文结尾', reasoning: '快照推理', usage: { totalTokens: 20 } });
    expect(partials.some(partial => partial.markdown === '旧正文')).toBe(true); expect(partials.every(partial => !partial.markdown.includes('绝不能重复追加'))).toBe(true);
    expect(h.streamRequests[1]).toMatchObject({ operation: 'resume', after: '3-0' }); expect(h.controlRequests).toHaveLength(0);
    expect(host.recovery.getSnapshot().pointer).toMatchObject({ cursor: '6-0', state: 'completed' });
  });
  it('a snapshot with absent telemetry replaces old telemetry and usage rather than retaining stale counters', async () => {
    const { host } = context(); const h = native([peer => {
      peer.response(); peer.emit(textEvent()); peer.emit(event('2-0', 'telemetry', { usage: { totalTokens: 999 } }));
      peer.emit(event('3-0', 'snapshot', { status: 'running', markdown: '终态快照正文', reasoning: '', lastEventId: '3-0', updatedAt: now, telemetry: null }));
      peer.emit(doneEvent('4-0')); peer.end();
    }]);
    const result = await execute(h, host);
    expect(result).toMatchObject({ status: 'completed', markdown: '终态快照正文', hosted: { telemetry: null } });
    expect(result.usage).toBeUndefined();
  });
  it('explicit stop waits for C0 acknowledgement and returns acceptance without claiming terminal', async () => {
    const { host } = context(); const abort = new AbortController(); const hold = deferred<void>(); const answer = deferred<DesktopArenaHostedControlResponse>();
    const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.end(); }], () => answer.promise);
    let settled = false;
    const pending = execute(h, host, input(), intent(), abort.signal, partial => { if (partial.markdown) abort.abort(ARENA_HOSTED_USER_STOP); });
    void pending.then(() => { settled = true; });
    await vi.waitFor(() => expect(h.controlRequests).toHaveLength(1)); const settledBeforeConfirmation = settled;
    answer.resolve({ status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' }); hold.resolve();
    const result = await pending;
    expect(settledBeforeConfirmation).toBe(false);
    expect(result).toMatchObject({ status: 'cancelled', hosted: { connectionState: 'cancelled', serverStatus: null, terminal: null } });
    expect(host.recovery.getSnapshot().pointer?.state).toBe('cancelled');
    expect(result).not.toHaveProperty('canAppendHistory', true);
  });
  it.each([409, 404])('stop HTTP %s remains unconfirmed and cannot turn retained text into a completed report', async status => {
    const { host } = context(); const abort = new AbortController(); const hold = deferred<void>();
    const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.end(); }], () => ({
      status, body: status === 409 ? { status: 'finalizing', cancelled: false } : { code: 'NOT_FOUND' }, recoveryCredentialState: 'stored',
    }));
    const result = await execute(h, host, input(), intent(), abort.signal, partial => { if (partial.markdown) abort.abort(ARENA_HOSTED_USER_STOP); }); hold.resolve();
    expect(result).toMatchObject({ status: 'cancelled', markdown: source, hosted: { connectionState: 'cancel_unconfirmed', serverStatus: null, terminal: null } });
    expect(host.recovery.getSnapshot().pointer?.state).toBe('cancel_unconfirmed'); expect(result).not.toHaveProperty('canAppendHistory', true);
    expect(h.controlRequests).toHaveLength(1); expect(h.streamRequests).toHaveLength(1);
  });
  it('the real five-second C0 stop timeout remains unconfirmed and ignores a late 202', async () => {
    vi.useFakeTimers();
    const { host } = context(); const abort = new AbortController(); const hold = deferred<void>(); const answer = deferred<DesktopArenaHostedControlResponse>();
    try {
      const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.end(); }], () => answer.promise);
      const pending = execute(h, host, input(), intent(), abort.signal, partial => { if (partial.markdown) abort.abort(ARENA_HOSTED_USER_STOP); });
      await vi.waitFor(() => expect(h.controlRequests).toHaveLength(1)); await vi.advanceTimersByTimeAsync(5_001);
      const result = await pending;
      expect(result).toMatchObject({ status: 'cancelled', markdown: source, hosted: { connectionState: 'cancel_unconfirmed', terminal: null } });
      expect(host.recovery.getSnapshot().pointer?.state).toBe('cancel_unconfirmed');
      answer.resolve({ status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' }); hold.resolve();
      await vi.advanceTimersByTimeAsync(0); expect(host.recovery.getSnapshot().pointer?.state).toBe('cancel_unconfirmed');
      expect(h.streamRequests).toHaveLength(1); expect(h.controlRequests).toHaveLength(1);
    } finally { answer.resolve({ status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' }); hold.resolve(); vi.useRealTimers(); }
  });
  it('a late stop acknowledgement after scope change cannot publish or persist into the new owner', async () => {
    let current = true; const { host, store } = context({ isCurrent: () => current }); const abort = new AbortController();
    const hold = deferred<void>(); const answer = deferred<DesktopArenaHostedControlResponse>(); const seen: ArenaHostedPartial[] = [];
    const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.emit(doneEvent()); peer.end(); }], () => answer.promise);
    const pending = execute(h, host, input(), intent(), abort.signal, partial => { seen.push(partial); if (partial.markdown) abort.abort(ARENA_HOSTED_USER_STOP); });
    await vi.waitFor(() => expect(h.controlRequests).toHaveLength(1)); current = false;
    const writes = store.setItem.mock.calls.length, publications = seen.length;
    answer.resolve({ status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' }); hold.resolve();
    const result = await pending; await Promise.resolve(); await Promise.resolve();
    expect(result).toMatchObject({ status: 'cancelled', scopeKey: 'account-A:epoch-1' }); expect(result).not.toHaveProperty('canAppendHistory', true);
    expect(store.setItem).toHaveBeenCalledTimes(writes); expect(seen).toHaveLength(publications);
  });
  it('stop 202 is acceptance, not server terminal or completion effects', async () => {
    const { host } = context(); const abort = new AbortController(); const hold = deferred<void>();
    const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.emit(doneEvent()); peer.end(); }], request => {
      expect(request.operation).toBe('stop'); return { status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' };
    });
    const result = await execute(h, host, input(), intent(), abort.signal, partial => { if (partial.markdown) abort.abort(ARENA_HOSTED_USER_STOP); }); hold.resolve();
    expect(result).toMatchObject({ status: 'cancelled', markdown: source, hosted: { serverStatus: null, terminal: null } }); expect(result).not.toHaveProperty('canAppendHistory', true);
    expect(h.controlRequests).toEqual([{ operation: 'stop', product: 'battle', requestId, actor: host.actor, generationId, reason: 'user' }]);
    expect(h.streamRequests.filter(request => request.operation === 'create-stream')).toHaveLength(1);
    expect(h.invoke.mock.calls.map(([command]) => command)).toContain(ARENA_HOSTED_DETACH_COMMAND);
  });
  it('local detach never sends stop or accepts a late terminal', async () => {
    const { host } = context(); const abort = new AbortController(); const hold = deferred<void>();
    const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.emit(doneEvent()); peer.end(); }]);
    const result = await execute(h, host, input(), intent(), abort.signal, partial => { if (partial.markdown) abort.abort(ARENA_HOSTED_DETACH); }); hold.resolve();
    expect(result).toMatchObject({ status: 'cancelled', markdown: source }); expect(h.controlRequests).toHaveLength(0);
    expect(result).not.toHaveProperty('canAppendHistory', true); expect(result.hosted.terminal).toBeNull();
  });
  it('scope changes before late terminal prevent publication, persistence and old completion qualification', async () => {
    let current = true; const { host, store } = context({ isCurrent: () => current }); const seen: ArenaHostedPartial[] = []; const hold = deferred<void>();
    const h = native([async peer => { peer.response(); peer.emit(textEvent()); await hold.promise; peer.emit(doneEvent()); peer.end(); }]);
    const pending = execute(h, host, input(), intent(), new AbortController().signal, partial => seen.push(partial));
    await vi.waitFor(() => expect(seen.some(partial => partial.markdown === source)).toBe(true)); current = false;
    const publications = seen.length, writes = store.setItem.mock.calls.length; hold.resolve(); const result = await pending;
    expect(result).not.toHaveProperty('canAppendHistory', true); expect(result.scopeKey).toBe('account-A:epoch-1');
    expect(seen).toHaveLength(publications); expect(store.setItem).toHaveBeenCalledTimes(writes);
  });
  it('scope changes during lookup prevent resume and late persistence', async () => {
    let current = true; const old = pointer(); const { host, store } = context({ isCurrent: () => current }, old); const answer = deferred<DesktopArenaHostedControlResponse>();
    const h = native([], () => answer.promise); const pending = resumeArenaHosted({ invoke: h.invoke }, old, host, new AbortController().signal);
    await vi.waitFor(() => expect(h.controlRequests).toHaveLength(1)); current = false; const writes = store.setItem.mock.calls.length;
    answer.resolve(lookupReply()); const result = await pending;
    expect(result.status).toBe('failed'); expect(h.streamRequests).toHaveLength(0); expect(store.setItem).toHaveBeenCalledTimes(writes); expect(h.controlRequests).toHaveLength(1);
  });
  it('missing header metadata and later meta_error never invent a winner or apply older role effects', async () => {
    const { host } = context(); const h = native([peer => {
      peer.response({ metadataState: 'oversized' }); peer.emit(textEvent());
      peer.emit(event('2-0', 'meta', { parseOk: true, meta: { report: { headline: '旧标题', winner: '旧胜者' }, impacts: [{ characterName: '甲', impact: '不应写卡' }] }, raw: '{}', rawTruncated: false }));
      peer.emit(event('3-0', 'meta_error', { parseOk: false, error: 'latest metadata unavailable' })); peer.emit(doneEvent('4-0')); peer.end();
    }]);
    const result = await execute(h, host);
    expect(result).toMatchObject({ status: 'completed', markdown: source, hosted: { metadataState: 'oversized', metaEvent: { event: 'meta_error' } },
      report: { headline: '相遇', officialReport: { winner: '' }, reporterInfo: { name: '', publication: '' } } });
    expect(result).not.toHaveProperty('impacts'); expect(result).not.toHaveProperty('updatedCombatants'); expect(h.streamRequests).toHaveLength(1); expect(h.controlRequests).toHaveLength(0);
  });
  it.each(['failed', 'cancelled', 'producer_lost', 'eof'] as const)('%s cannot borrow C0 connection state as completed business authority', async status => {
    const { host } = context({ maxReconnectAttempts: 0 }); const h = native([peer => {
      peer.response(); peer.emit(textEvent()); if (status !== 'eof') peer.emit(event('2-0', status === 'producer_lost' ? 'error' : 'done', { ok: false, status })); peer.end();
    }]);
    const result = await execute(h, host); expect(result).toMatchObject({ status: 'failed', markdown: source });
    expect(result).not.toHaveProperty('canAppendHistory', true); expect(h.streamRequests).toHaveLength(1);
  });
});

describe('Hosted done Artifact plus body and exact Base qualification', () => {
  it.each([
    ['application/json', 'data/report.json', '{"title":"相遇"}'], ['text/html', 'index.html', freeWeb],
    ['text/javascript', 'runtime/report.js', 'export const title = "相遇";\n'], ['text/css', 'styles/report.css', '.report { color: rebeccapurple; }\n'],
  ])('%s uses the real target validator and sends only canonical prompt projection', async (mediaType, target, content) => {
    const base = await packageBase(target, mediaType); const { generatedContent: _, ...artifact } = await createWebPackageOverlayFromBase(base, content);
    const { host } = context({ resolveWebPackage: async () => base }); const h = native([complete(content, { webPackage: artifact })]);
    const result = await execute(h, host, { ...input('daily', 'web'), webPackageRef: base.ref });
    expect(result).toMatchObject({ status: 'completed', canAppendHistory: true, hosted: { outputValidation: 'valid' }, renderSnapshot: { webPackage: artifact } });
    expect(artifact).not.toHaveProperty('generatedContent'); expect(h.streamRequests[0]).toHaveProperty('body.webPackagePromptProjection');
    expect(h.streamRequests[0]).not.toHaveProperty('body.files'); expect(h.streamRequests[0]).not.toHaveProperty('body.adjudicationResults');
  });
  it.each(['missing-artifact', 'digest', 'target', 'ref', 'schema'] as const)('%s keeps server completion but denies output/history qualification', async fault => {
    const base = await packageBase(); const content = '{"title":"相遇"}'; const { generatedContent: _, ...good } = await createWebPackageOverlayFromBase(base, content);
    const artifact = { ...good, ...(fault === 'digest' ? { generatedDigest: `sha256:${'0'.repeat(64)}` } : {}), ...(fault === 'target' ? { targetPath: 'other.json' } : {}),
      ...(fault === 'ref' ? { packageRef: { ...base.ref, version: '2.0.0' } } : {}) };
    const actual = fault === 'schema' ? '{"unrecognized":true}' : content;
    const { host } = context({ resolveWebPackage: async () => base }); const h = native([complete(actual, fault === 'missing-artifact' ? {} : { webPackage: artifact })]);
    expect(await execute(h, host, { ...input('daily', 'web'), webPackageRef: base.ref })).toMatchObject({ status: 'completed', markdown: actual, canAppendHistory: false,
      hosted: { serverStatus: 'completed', outputValidation: 'invalid' } });
  });
  it('fresh recovery with missing exact Base keeps Artifact and text without auto-selecting latest', async () => {
    const base = await packageBase(); const content = '{"title":"相遇"}'; const { generatedContent: _, ...artifact } = await createWebPackageOverlayFromBase(base, content);
    const old = pointer({ format: 'web', battleMode: 'daily', webPackageRef: base.ref });
    const resolve = vi.fn(async () => { throw new Error('exact Base deleted'); }); const { host } = context({ resolveWebPackage: resolve }, old); const h = native([complete(content, { webPackage: artifact })]);
    const result = await resumeArenaHosted({ invoke: h.invoke }, old, host, new AbortController().signal);
    expect(result).toMatchObject({ status: 'completed', markdown: content, canAppendHistory: false,
      hosted: { outputValidation: 'missing-base', serverStatus: 'completed' }, renderSnapshot: { webPackage: artifact } });
    expect(resolve).toHaveBeenCalledExactlyOnceWith(base.ref); expect(h.streamRequests.every(request => request.operation === 'resume')).toBe(true);
  });
});

it.each(['prior-retained', 'current-owned', 'unknown'] as const)('uses Native %s ownership proof rather than dispatchState to retain the correct recovery intent', async (intentOwnership) => {
  const previous = pointer({ requestId: 'prior-request-id' });
  const { host, store } = context({ replaceRequestId: previous.requestId }, previous);
  const oldRaw = store.values.get(ARENA_HOSTED_RECOVERY_KEYS.battle);
  const h = native([() => { throw { code: 'invalid-request', message: 'fixed synthetic failure', dispatchState: 'not-dispatched', intentOwnership }; }]);
  const result = await executeArenaHosted({ invoke: h.invoke }, input(), intent(), host, new AbortController().signal);
  expect(result.status).toBe('failed'); expect(h.streamRequests).toHaveLength(1); expect(h.controlRequests).toHaveLength(0);
  expect(host.recovery.getSnapshot().pointer?.requestId).toBe(intentOwnership === 'prior-retained' ? previous.requestId : requestId);
  if (intentOwnership === 'prior-retained') expect(store.values.get(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(oldRaw);
});

it('keeps an external new pointer through late prior-retained rollback and the real C0 failed-state save', async () => {
  const previous = pointer({ requestId: 'prior-request-id' });
  const { host, store } = context({ replaceRequestId: previous.requestId }, previous);
  const entered = deferred<void>(), release = deferred<void>();
  const h = native([async () => { entered.resolve(); await release.promise; throw { code: 'invalid-request', message: 'fixed synthetic failure', dispatchState: 'not-dispatched', intentOwnership: 'prior-retained' }; }]);
  const running = execute(h, host); await entered.promise;
  const external = JSON.stringify(pointer({ requestId: 'external-new-request' })); store.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, external);
  release.resolve(); expect((await running).status).toBe('failed');
  expect(host.recovery.getSnapshot().pointer?.state).toBe('failed');
  expect(store.values.get(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(external);
  expect(h.controlRequests).toHaveLength(0); expect(h.streamRequests).toHaveLength(1);
});

it('shows exact 5/10 minute soft warnings without stopping, reconnecting or restarting and still accepts late completion', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const { host } = context(); const ready = deferred<void>(), release = deferred<void>();
  const partials: ArenaHostedPartial[] = [];
  const h = native([async peer => { peer.response(); ready.resolve(); await release.promise; peer.emit(textEvent()); peer.emit(doneEvent()); peer.end(); }]);
  const running = execute(h, host, input(), intent(), new AbortController().signal, value => partials.push(value));
  try {
    await ready.promise; await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(299_999); expect(partials.some(value => value.hosted.softTimeoutWarning)).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(partials.at(-1)?.hosted.softTimeoutWarning).toContain('300 秒仍未收到新内容');
    expect(h.controlRequests).toHaveLength(0); expect(h.streamRequests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300_000); expect(partials.at(-1)?.hosted.softTimeoutWarning).toContain('600 秒仍未结束生成');
    expect(h.controlRequests).toHaveLength(0); expect(h.streamRequests).toHaveLength(1);
    release.resolve(); const result = await running;
    expect(result).toMatchObject({ status: 'completed', markdown: source }); expect(result.hosted.softTimeoutWarning).toBeNull();
  } finally { release.resolve(); await running; vi.useRealTimers(); }
});

it('does not publish a late soft-warning timer into a changed owner scope', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); let current = true;
  const { host } = context({ isCurrent: () => current }); const ready = deferred<void>(), release = deferred<void>();
  const partials: ArenaHostedPartial[] = [];
  const h = native([async peer => { peer.response(); ready.resolve(); await release.promise; peer.emit(textEvent()); peer.emit(doneEvent()); peer.end(); }]);
  const running = execute(h, host, input(), intent(), new AbortController().signal, value => partials.push(value));
  try {
    await ready.promise; await vi.advanceTimersByTimeAsync(0); const before = partials.length; current = false;
    await vi.advanceTimersByTimeAsync(600_000); expect(partials).toHaveLength(before);
    expect(partials.some(value => value.hosted.softTimeoutWarning)).toBe(false);
    release.resolve(); expect((await running).status).toBe('failed');
    expect(h.controlRequests).toHaveLength(0); expect(h.streamRequests).toHaveLength(1);
  } finally { release.resolve(); await running; vi.useRealTimers(); }
});
