import { describe, expect, it, vi } from 'vitest';
import {
  DesktopArenaHostedStoryCreateRequestSchema, DesktopArenaHostedStoryRecoveryPointerSchema,
  type DesktopArenaHostedStoryCreateRequest, type DesktopArenaHostedStoryRecoveryPointer,
} from '@mahoshojo/contracts/desktop-arena-story-transport';
import {
  DesktopArenaHostedControlRequestSchema, DesktopArenaHostedStreamRequestSchema,
  type DesktopArenaHostedActor, type DesktopArenaHostedControlRequest, type DesktopArenaHostedControlResponse,
} from '@mahoshojo/contracts/desktop-arena-hosted';
import { openArenaHostedStoryTransport, ARENA_HOSTED_STORY_USER_STOP } from '../src/features/arena/hosted-story-transport';
import { openArenaHostedStream, type ArenaHostedChannel } from '../src/platform/arena-hosted-bridge';

const requestId = 'story-transport-1234', generationId = `arena_${'a'.repeat(64)}`;
const bodyHash = 'b'.repeat(64), inputDigest = `sha256:${'c'.repeat(64)}`;
const now = '2026-10-10T18:00:00.000Z';
const pointer = (patch: Partial<DesktopArenaHostedStoryRecoveryPointer> = {}) => DesktopArenaHostedStoryRecoveryPointerSchema.parse({
  version: 4, purpose: 'story', delivery: 'stream', protocolVersion: 'arena-hosted-sse-v1', storyProtocolVersion: 'arena-story-v1',
  product: 'battle', requestId, bodyHash, inputDigest, actor: { kind: 'anonymous' },
  format: 'markdown', battleMode: 'daily', sessionId: 'story-session', operationId: 'story-operation',
  state: 'prepared', updatedAt: now, ...patch,
});
const create = (original = pointer(), funding: 'system' | 'preset' = 'system') => DesktopArenaHostedStoryCreateRequestSchema.parse({
  operation: 'create-story-stream', product: original.product, requestId: original.requestId, actor: original.actor,
  pendingRevision: 3, inputDigest, clientBodyHash: bodyHash,
  ...(funding === 'system' ? { systemConfig: { modelId: 'deepseek-chat' } } : { presetConfig: { providerId: 'deepseek', modelId: 'deepseek-chat' } }),
});
const lookup = (status = 200): DesktopArenaHostedControlResponse => ({ status, body: status === 200
  ? { generationId, generationRequestId: requestId, status: 'completed' } : { code: 'NOT_FOUND' }, recoveryCredentialState: 'stored' });
type Request = DesktopArenaHostedStoryCreateRequest | ReturnType<typeof DesktopArenaHostedStreamRequestSchema.parse>;
interface Peer {
  request: Request;
  response(patch?: Record<string, unknown>): void;
  event(id: string, event: string, data: unknown): void;
  end(): void;
}
function native(steps: Array<(peer: Peer) => void | Promise<void>>,
  control: (request: DesktopArenaHostedControlRequest) => DesktopArenaHostedControlResponse | Promise<DesktopArenaHostedControlResponse> = () => lookup()) {
  const streams: Request[] = [], controls: DesktopArenaHostedControlRequest[] = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') return;
    if (command === 'arena_hosted_control') {
      const request = DesktopArenaHostedControlRequestSchema.parse(args?.request); controls.push(request); return control(request);
    }
    expect(command).toBe('arena_hosted_stream');
    const raw = args?.request as Request;
    const request = raw.operation === 'create-story-stream' ? DesktopArenaHostedStoryCreateRequestSchema.parse(raw) : DesktopArenaHostedStreamRequestSchema.parse(raw);
    streams.push(request);
    const channel = args!.onEvent as ArenaHostedChannel; let sequence = 0;
    const send = (event: Record<string, unknown>) => channel.onmessage({ requestId: request.requestId, sequence: sequence++, ...event });
    const peer: Peer = { request,
      response: patch => send({ kind: 'response', status: 200, generationId, generationRequestId: requestId,
        metadataState: 'missing', recoveryCredentialState: 'stored', ...patch }),
      event: (id, event, data) => send({ kind: 'sse-fragment', text: `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`, final: true }),
      end: () => send({ kind: 'stream-end' }),
    };
    const step = steps[streams.length - 1]; if (!step) throw new Error('unexpected stream'); await step(peer);
  });
  return { invoke, streams, controls };
}
const complete = (peer: Peer) => {
  peer.response(); peer.event('1-0', 'markdown', { chunk: '原故事正文' });
  peer.event('2-0', 'done', { ok: true, status: 'completed' }); peer.end();
};
const options = { createChannel: () => ({ onmessage: (_value: unknown) => undefined }), wait: async () => undefined, maxReconnectAttempts: 1 };

describe('Hosted story reuses Native Channel and C0 without a story owner', () => {
  for (const product of ['battle', 'arena'] as const) for (const actor of [{ kind: 'anonymous' }, { kind: 'account', expectedUserId: 7 }] as DesktopArenaHostedActor[]) {
    it.each(['system', 'preset'] as const)(`${product}/${actor.kind}/%s sends only the exact sealed-input scope`, async funding => {
      const p = pointer({ product, actor }), request = create(p, funding), h = native([complete]);
      const response = await openArenaHostedStoryTransport(h.invoke, { mode: 'create', pointer: p, request }, options);
      expect(await response.text()).toContain('原故事正文'); expect(h.streams).toEqual([request]); expect(h.controls).toEqual([]);
      expect(h.streams[0]).not.toHaveProperty('body'); expect(h.streams[0]).not.toHaveProperty('combatants');
    });
  }
  it('cold recovery ignores a saved generation/cursor for C0 startup and first checks the original actor', async () => {
    const original = pointer({ actor: { kind: 'account', expectedUserId: 17 }, generationId, cursor: '99-0', state: 'completed' });
    const h = native([complete]); const states: unknown[] = [];
    const response = await openArenaHostedStoryTransport(h.invoke, { mode: 'recover', pointer: original }, { ...options, onRecoveryState: state => states.push(state) });
    expect(await response.text()).toContain('原故事正文');
    expect(states[0]).toMatchObject({ generationId: null, lastEventId: null });
    expect(h.controls).toEqual([{ operation: 'lookup-request', product: 'battle', requestId, actor: original.actor, restoreSession: true }]);
    expect(h.streams).toEqual([{ operation: 'resume', product: 'battle', requestId, actor: original.actor, generationId }]);
  });
  it('hot reconnect uses only the prefix delivered within this C0 subscription and deduplicates replay', async () => {
    const h = native([
      peer => { peer.response(); peer.event('1-0', 'markdown', { chunk: '前缀' }); peer.end(); },
      peer => { peer.response(); peer.event('1-0', 'markdown', { chunk: '前缀' }); peer.event('2-0', 'markdown', { chunk: '后缀' }); peer.event('3-0', 'done', { ok: true, status: 'completed' }); peer.end(); },
    ]);
    const response = await openArenaHostedStoryTransport(h.invoke, { mode: 'create', pointer: pointer(), request: create() }, options);
    const text = await response.text(); expect(text.match(/前缀/gu)).toHaveLength(1); expect(text).toContain('后缀');
    expect(h.streams[1]).toMatchObject({ operation: 'resume', after: '1-0', generationId }); expect(h.controls).toEqual([]);
  });
  it.each(['recover', 'ambiguous-create'] as const)('%s 404 never creates again or swaps the original scope', async mode => {
    const h = native(mode === 'recover' ? [] : [() => { throw new Error('before first header'); }], () => lookup(404));
    await expect(openArenaHostedStoryTransport(h.invoke, mode === 'recover'
      ? { mode: 'recover', pointer: pointer({ state: 'unknown', generationId, cursor: '50-0' }) }
      : { mode: 'create', pointer: pointer(), request: create() }, options)).rejects.toThrow('ARENA_GENERATION_STATE_UNKNOWN');
    expect(h.streams).toHaveLength(mode === 'recover' ? 0 : 1); expect(h.controls).toHaveLength(2);
    expect(h.controls.every(request => request.operation === 'lookup-request' && request.requestId === requestId)).toBe(true);
    expect(h.controls.filter(request => 'restoreSession' in request && request.restoreSession)).toHaveLength(mode === 'recover' ? 1 : 0);
  });
  it('a proven pre-dispatch capability rejection cannot start fallback or lookup', async () => {
    const h = native([() => { throw { code: 'capability-unavailable', message: 'private', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' }; }]);
    await expect(openArenaHostedStoryTransport(h.invoke, { mode: 'create', pointer: pointer(), request: create() }, options)).rejects.toMatchObject({ code: 'capability-unavailable' });
    expect(h.streams).toHaveLength(1); expect(h.controls).toEqual([]);
  });
  it('a late lookup from an old actor cannot resume or publish into a changed owner scope', async () => {
    let current = true, resolve!: (value: DesktopArenaHostedControlResponse) => void;
    const h = native([], () => new Promise(yes => { resolve = yes; })); const states: unknown[] = [];
    const running = openArenaHostedStoryTransport(h.invoke, { mode: 'recover', pointer: pointer() }, {
      ...options, isCurrent: () => current, onRecoveryState: state => states.push(state),
    });
    await vi.waitFor(() => expect(h.controls).toHaveLength(1)); current = false; const count = states.length; resolve(lookup());
    await expect(running).rejects.toThrow(); expect(h.streams).toEqual([]); expect(states).toHaveLength(count); expect(h.controls).toHaveLength(1);
  });
  it('a conflicting original generation cannot be replaced by lookup', async () => {
    const h = native([], () => lookup());
    await expect(openArenaHostedStoryTransport(h.invoke, { mode: 'recover', pointer: pointer({ generationId: `arena_${'f'.repeat(64)}` }) }, options)).rejects.toThrow();
    expect(h.streams).toEqual([]);
  });
  it.each([
    { inputDigest: `sha256:${'d'.repeat(64)}` }, { clientBodyHash: 'd'.repeat(64) },
    { actor: { kind: 'account', expectedUserId: 999 } }, { product: 'arena' }, { requestId: 'foreign-request-1234' },
  ])('rejects a create/pointer identity mismatch before Native %#', async patch => {
    const invoke = vi.fn();
    await expect(openArenaHostedStoryTransport(invoke, { mode: 'create', pointer: pointer(), request: { ...create(), ...patch } as DesktopArenaHostedStoryCreateRequest }, options)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects renderer body authority even when passed through the common stream bridge', () => {
    const invoke = vi.fn();
    expect(() => openArenaHostedStream(invoke, { ...create(), body: { combatants: [] } } as DesktopArenaHostedStoryCreateRequest, options)).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('local detach never dispatches a server stop', async () => {
    const controller = new AbortController(); const h = native([peer => { peer.response(); controller.abort('detached'); peer.end(); }]);
    const response = await openArenaHostedStoryTransport(h.invoke, { mode: 'create', pointer: pointer(), request: create() }, { ...options, signal: controller.signal });
    await expect(response.text()).rejects.toThrow();
    expect(h.controls).toEqual([]); expect(h.invoke.mock.calls.some(([command]) => command === 'arena_hosted_detach')).toBe(true);
  });
  it('explicit user stop uses the existing C0 control operation and does not imply model completion', async () => {
    const controller = new AbortController(); const states: string[] = [];
    const h = native([peer => { peer.response(); controller.abort(ARENA_HOSTED_STORY_USER_STOP); peer.end(); }], () => ({ status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' }));
    const result = await openArenaHostedStoryTransport(h.invoke, { mode: 'create', pointer: pointer(), request: create() }, { ...options, signal: controller.signal, onStateChange: state => states.push(state) }).catch(error => error);
    if (result instanceof Response) await result.text().catch(() => undefined);
    expect(h.controls).toHaveLength(1); expect(h.controls[0]).toMatchObject({ operation: 'stop', requestId, reason: 'user' });
    expect(states).not.toContain('completed');
  });
});
