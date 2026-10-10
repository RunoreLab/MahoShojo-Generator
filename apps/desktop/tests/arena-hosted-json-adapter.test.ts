import { describe, expect, it, vi } from 'vitest';
import { ARENA_COMPANION_PROTOCOL_VERSION, ArenaCompanionEnvelopeSchema, type ArenaCompanionEnvelope } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedJsonCreateRequestSchema, DesktopArenaHostedRecoveryPointerV2Schema } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { DesktopArenaHostedControlRequestSchema, DesktopArenaHostedControlResponseSchema, DesktopArenaHostedStreamRequestSchema } from '@mahoshojo/contracts/desktop-arena-hosted';
import { executeArenaHosted, resumeArenaHosted, ARENA_HOSTED_USER_STOP, ARENA_HOSTED_DETACH, type ArenaHostedContext, type ArenaHostedIntent, type ArenaHostedPartial } from '../src/features/arena/hosted';
import { DesktopArenaHostedRecovery, ARENA_HOSTED_RECOVERY_KEYS } from '../src/features/arena/hosted-recovery';
import { createInitialArenaDraft, buildDesktopArenaInput } from '../src/features/arena/session';
import type { ArenaHostedChannel } from '../src/platform/arena-hosted-bridge';
const requestId = 'json-adapter-request', generationId = `arena_${'c'.repeat(64)}`, now = '2026-10-10T07:00:00.000Z';
const model = { headline: '完整标题', article: { body: '正文😀', analysis: '分析' }, officialReport: { winner: '甲', conclusion: '结论' } };
function input(mode = 'daily', format: 'markdown' | 'web' = 'markdown') {
  const draft = createInitialArenaDraft();
  return buildDesktopArenaInput({ ...draft, battleMode: mode as typeof draft.battleMode, reportFormat: format, generationMode: 'non-stream',
    scenario: { content: mode === 'scenario' ? { title: '车站', content: '等待' } : null, fileName: null },
    combatants: ['甲', '乙'].map(name => ({ type: 'general-character' as const, isValid: true, isPreset: false, filename: `${name}.json`, data: { name, content: '原设定' } })) });
}
function envelope(mode = 'daily', format: 'markdown' | 'web' = 'markdown'): ArenaCompanionEnvelope {
  const html = '<!doctype html><html><body>安全源码</body></html>';
  return ArenaCompanionEnvelopeSchema.parse({ version: ARENA_COMPANION_PROTOCOL_VERSION,
    body: { report: { ...model, mode, reporterInfo: { name: '记者', publication: '刊物' },
      ...(format === 'web' ? { reportFormat: 'web', webHtml: html, article: { body: html, analysis: '分析' } } : {}),
      aiReasoning: { status: 'complete', text: '推理' }, aiModel: 'default', aiUsage: { completionTokens: 18014398509481982 },
      userGuidance: '\ud800', characterGuidances: [{ characterName: '甲', guidance: '\udc00' }] },
      updatedCombatants: [], generationId }, metadata: { reportFormat: format, outputContract: format === 'web' ? 'web-document' : 'structured-report',
      mode, language: 'zh-CN', storyLength: 'medium', scenarioDisplayName: '原情景', userGuidance: '\ud800' } });
}
function context(product: 'battle' | 'arena' = 'battle') {
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const host: ArenaHostedContext = { product, scopeKey: 'scope-A', actor: { kind: 'anonymous' }, recovery: new DesktopArenaHostedRecovery(storage, product),
    now: () => now, createChannel: () => ({ onmessage: () => undefined }), wait: async () => undefined, maxReconnectAttempts: 0 };
  return { host, storage, values };
}
const intent: ArenaHostedIntent = { requestId, mode: 'hosted', generationMode: 'non-stream', modelId: 'default', systemConfig: {} };
function native(options: { hold?: boolean; fail?: unknown; reply?: ArenaCompanionEnvelope; lookupStatus?: number; raw?: string; restored?: boolean } = {}) {
  const operations: Record<string, unknown>[] = []; let release!: () => void, started!: () => void;
  const ready = new Promise<void>(yes => { started = yes; }); const held = new Promise<void>(yes => { release = yes; });
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') return;
    const request = args!.request as Record<string, unknown>; operations.push(request);
    if (request.operation === 'lookup-request' || request.operation === 'stop') {
      DesktopArenaHostedControlRequestSchema.parse(request);
      const status = request.operation === 'lookup-request' ? options.lookupStatus ?? 200 : 202;
      return DesktopArenaHostedControlResponseSchema.parse({ status, recoveryCredentialState: 'stored', body: status === 404 ? { code: 'NOT_FOUND' }
        : { generationId, generationRequestId: requestId, status: request.operation === 'stop' ? 'cancelling' : 'completed' } });
    }
    const channel = args!.onEvent as ArenaHostedChannel; let sequence = 0;
    const send = (value: Record<string, unknown>) => channel.onmessage({ requestId, sequence: sequence++, ...value });
    if (request.operation === 'create-json') {
      DesktopArenaHostedJsonCreateRequestSchema.parse(request); started(); if (options.hold) await held;
      if (options.fail) throw options.fail;
      send({ kind: 'json-response', status: options.reply && !('report' in options.reply.body) ? 502 : 200, generationId, generationRequestId: requestId, recoveryCredentialState: 'stored' });
      const value = options.reply ?? envelope((request.body as { mode: string }).mode, (request.body as { reportFormat: 'markdown' | 'web' }).reportFormat);
      const raw = options.raw ?? JSON.stringify(value);
      for (let offset = 0; offset < raw.length; offset += 83) send({ kind: 'json-fragment', text: raw.slice(offset, offset + 83), final: offset + 83 >= raw.length });
      send({ kind: 'json-end' }); return;
    }
    DesktopArenaHostedStreamRequestSchema.parse(request);
    send({ kind: 'response', status: 200, generationId, generationRequestId: requestId, metadataState: 'missing', recoveryCredentialState: 'stored' });
    const data = { status: 'completed', markdown: JSON.stringify(model), reasoning: '', lastEventId: '1-0', updatedAt: now, telemetry: null };
    send({ kind: 'sse-fragment', final: true, text: `id: 1-0\nevent: snapshot\ndata: ${JSON.stringify(data)}\n\n` });
    send({ kind: 'sse-fragment', final: true, text: 'id: 2-0\nevent: done\ndata: {"status":"completed","ok":true}\n\n' }); send({ kind: 'stream-end' });
  });
  return { invoke, operations, ready, release };
}
const run = (n: ReturnType<typeof native>, c = context(), signal = new AbortController().signal, onPartial?: (value: ArenaHostedPartial) => void) => executeArenaHosted({ invoke: n.invoke }, input(), intent, c.host, signal, onPartial);

describe('real complete companion bridge and C0 recovery adapter', () => {
  it.each(['classic', 'kizuna', 'daily', 'scenario'])('%s gives a genuine complete JSON report across two products/formats/actors/funding', async mode => {
    for (const product of ['battle', 'arena'] as const) for (const format of ['markdown', 'web'] as const)
      for (const account of [false, true]) for (const preset of [false, true]) {
        const c = context(product); if (account) c.host.actor = { kind: 'account', expectedUserId: 42 };
        const n = native({ reply: envelope(mode, format) });
        const funding = preset ? { presetConfig: { providerId: 'deepseek', modelId: 'deepseek-chat' } } : { systemConfig: {} };
        const result = await executeArenaHosted({ invoke: n.invoke }, input(mode, format), { ...intent, systemConfig: undefined, ...funding }, c.host, new AbortController().signal);
        expect(result).toMatchObject({ status: 'completed', generationId, canAppendHistory: true,
          hosted: { delivery: 'non-stream', companionState: 'complete', terminal: null, metadataState: 'available', companion: envelope(mode, format) } });
        expect(n.operations).toHaveLength(1); expect(n.operations[0]).toMatchObject({ operation: 'create-json', reconciliationVersion: 'arena-reconciliation-v1', body: { writeArenaHistory: true, writeCurrentState: true } });
        expect(c.host.recovery.getSnapshot().pointer).toMatchObject({ version: 3, delivery: 'non-stream', generationId, state: 'completed' });
        if (result.status === 'completed') { expect(result.report.userGuidance).toBe('\ud800'); expect(result.report.aiUsage?.completionTokens).toBe(18014398509481982); }
      }
  });
  it('unknown create uses C0 lookup and stream recovery without a second create or explicit actor rebind', async () => {
    const n = native({ fail: new Error('lost before headers') }); const result = await run(n);
    expect(result).toMatchObject({ status: 'completed', markdown: model.article.body, rawText: JSON.stringify(model), canAppendHistory: true,
      report: model, hosted: { companion: null, companionState: 'recovered-model-only', metadataState: 'missing', restored: false } });
    expect(n.operations.map(op => op.operation)).toEqual(['create-json', 'lookup-request', 'resume']); expect(n.operations[1]).not.toHaveProperty('restoreSession');
    expect(n.operations[1]).not.toHaveProperty('presetConfig'); expect(n.operations[2]).not.toHaveProperty('body');
  });
  it('explicit v2 reopen uses no cursor and does not regain the original JSON or automatic history permission', async () => {
    const c = context(); const p = DesktopArenaHostedRecoveryPointerV2Schema.parse({ version: 2, delivery: 'non-stream', protocolVersion: ARENA_COMPANION_PROTOCOL_VERSION,
      product: 'battle', requestId, generationId, cursor: '9-0', bodyHash: 'a'.repeat(64), actor: c.host.actor, format: 'markdown', battleMode: 'daily', state: 'completed', updatedAt: now });
    c.storage.setItem(ARENA_HOSTED_RECOVERY_KEYS.battle, JSON.stringify(p)); c.host.recovery = new DesktopArenaHostedRecovery(c.storage, 'battle');
    const n = native(); const result = await resumeArenaHosted({ invoke: n.invoke }, p, c.host, new AbortController().signal);
    expect(result).toMatchObject({ status: 'completed', report: model, canAppendHistory: false, hosted: { restored: true, companionState: 'recovered-model-only' } });
    expect(n.operations[0]).toMatchObject({ operation: 'lookup-request', restoreSession: true }); expect(n.operations[1]).not.toHaveProperty('after');
  });
  it.each([200, 404])('stops before any headers via original request lookup; lookup %s never causes a second POST', async lookupStatus => {
    const n = native({ hold: true, lookupStatus }), abort = new AbortController(); const promise = run(n, context(), abort.signal);
    await n.ready; abort.abort(ARENA_HOSTED_USER_STOP); const result = await promise; n.release();
    expect(result).toMatchObject({ status: 'cancelled', hosted: { connectionState: lookupStatus === 200 ? 'cancelled' : 'cancel_unconfirmed' } });
    expect(n.operations.map(op => op.operation)).toEqual(lookupStatus === 200 ? ['create-json', 'lookup-request', 'stop'] : ['create-json', 'lookup-request']);
  });
  it('a lookup settling after the stop-confirmation window cannot dispatch a late stop', async () => {
    vi.useFakeTimers();
    try {
      const n = native({ hold: true }), abort = new AbortController();
      const original = n.invoke.getMockImplementation()!; let releaseLookup!: () => void, lookupStarted!: () => void;
      const lookupReady = new Promise<void>(yes => { lookupStarted = yes; });
      const lookupHeld = new Promise<void>(yes => { releaseLookup = yes; });
      n.invoke.mockImplementation(async (command, args) => {
        if ((args?.request as { operation?: string })?.operation === 'lookup-request') { lookupStarted(); await lookupHeld; }
        return original(command, args);
      });
      const promise = run(n, context(), abort.signal); await n.ready; abort.abort(ARENA_HOSTED_USER_STOP); await lookupReady;
      await vi.advanceTimersByTimeAsync(5000);
      expect(await promise).toMatchObject({ status: 'cancelled', hosted: { connectionState: 'cancel_unconfirmed' } });
      releaseLookup(); n.release(); await vi.advanceTimersByTimeAsync(0);
      expect(n.operations.map(op => op.operation)).toEqual(['create-json', 'lookup-request']);
    } finally { vi.useRealTimers(); }
  });
  it('an incomplete JSON after valid headers recovers structured source without retrying companion', async () => {
    const n = native({ raw: '{"version":' }); const result = await run(n);
    expect(result).toMatchObject({ status: 'completed', rawText: JSON.stringify(model), markdown: model.article.body,
      hosted: { companionState: 'recovered-model-only', companion: null } });
    expect(n.operations.map(op => op.operation)).toEqual(['create-json', 'lookup-request', 'resume']);
  });
  it('scope detach neither stops nor publishes a late complete envelope', async () => {
    const n = native({ hold: true }), c = context(), abort = new AbortController(), partial = vi.fn(); let current = true; c.host.isCurrent = () => current;
    const promise = run(n, c, abort.signal, partial); await n.ready; current = false; abort.abort(ARENA_HOSTED_DETACH); expect((await promise).status).toBe('cancelled');
    n.release(); await Promise.resolve(); expect(n.operations.map(op => op.operation)).toEqual(['create-json']); expect(partial).not.toHaveBeenCalled();
  });
  it('starts shared soft warnings while waiting for headers and still completes the same request', async () => {
    vi.useFakeTimers();
    try {
      const n = native({ hold: true }), c = context(), partials: ArenaHostedPartial[] = []; const promise = run(n, c, undefined, value => partials.push(value));
      await n.ready; await vi.advanceTimersByTimeAsync(299999); expect(partials).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1); expect(partials.at(-1)?.hosted.softTimeoutWarning).toContain('300');
      await vi.advanceTimersByTimeAsync(300000); expect(partials.at(-1)?.hosted.softTimeoutWarning).toContain('600');
      n.release(); const result = await promise; expect(result.status).toBe('completed'); expect(result.hosted.softTimeoutWarning).toBeNull(); expect(n.operations).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('metadata unsupported after producer completion stays a checked diagnostic with recoverable identity', async () => {
    const failure = ArenaCompanionEnvelopeSchema.parse({ version: ARENA_COMPANION_PROTOCOL_VERSION,
      body: { code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED', error: 'unsupported', generationId, status: 'completed' }, metadata: null });
    const n = native({ reply: failure }), c = context(); const result = await run(n, c);
    expect(result).toMatchObject({ status: 'failed', hosted: { serverStatus: 'completed', companion: failure } }); expect(c.host.recovery.getSnapshot().pointer?.state).toBe('completed'); expect(n.operations).toHaveLength(1);
  });
  it('a proven pre-dispatch failure rolls back only its owned new pointer', async () => {
    const c = context(), n = native({ fail: { code: 'capability-unavailable', dispatchState: 'not-dispatched', intentOwnership: 'prior-retained', message: 'private' } });
    expect((await run(n, c)).status).toBe('failed'); expect(c.host.recovery.getSnapshot().pointer).toBeNull(); expect(n.operations).toHaveLength(1);
  });
});
