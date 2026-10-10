import { describe, expect, it, vi } from 'vitest';
import { DesktopArenaHostedStreamRequestSchema, parseDesktopArenaHostedSseBlock } from '@mahoshojo/contracts/desktop-arena-hosted';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join } from 'node:path';
const fixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-arena-hosted.json', import.meta.url), 'utf8'));
import {
  ARENA_HOSTED_CONTROL_COMMAND, ARENA_HOSTED_DETACH_COMMAND, ARENA_HOSTED_STREAM_COMMAND,
  ArenaHostedBridgeError, readArenaHostedRecoveryHint, controlArenaHosted, openArenaHostedStream, type ArenaHostedChannel,
} from '../src/platform/arena-hosted-bridge';

const request = DesktopArenaHostedStreamRequestSchema.parse(fixture.validOperations[0]);
const generationId = `arena_${'a'.repeat(64)}`;
const response = { kind: 'response', requestId: request.requestId, sequence: 0, status: 200, generationId,
  generationRequestId: request.requestId, metadataState: 'missing', recoveryCredentialState: 'stored' };
const block = (event = 'markdown', data: unknown = { chunk: '安全正文 😀' }) => `id: 1-0\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
function harness() {
  const channel: ArenaHostedChannel = { onmessage: () => undefined };
  let resolve!: () => void, reject!: (value: unknown) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const invoke = vi.fn(async (command: string) => command === ARENA_HOSTED_STREAM_COMMAND ? pending : undefined);
  const start = (signal?: AbortSignal) => openArenaHostedStream(invoke, request, { signal, createChannel: () => channel });
  const send = (sequence: number, value: Record<string, unknown>) => channel.onmessage({ requestId: request.requestId, sequence, ...value });
  return { invoke, start, send, resolve, reject, channel };
}

describe('Arena Native Channel to C0 response bridge', () => {
  it('joins validated ordered fragments and exposes only the public generation handshake', async () => {
    const h = harness(); const promise = h.start(); h.channel.onmessage(response); const res = await promise;
    const text = block(); h.send(1, { kind: 'sse-fragment', text: text.slice(0, 20), final: false });
    h.send(2, { kind: 'sse-fragment', text: text.slice(20), final: true }); h.send(3, { kind: 'stream-end' }); h.resolve();
    expect(await res.text()).toBe(text); expect(res.headers.get('x-mahoshojo-generation-id')).toBe(generationId);
    expect(h.invoke.mock.calls.map(([command]) => command)).toEqual([ARENA_HOSTED_STREAM_COMMAND]);
  });
  it.each([
    { kind: 'sse-fragment', text: block(), final: true, sequence: 0 },
    { ...response, sequence: 1 },
    { ...response, requestId: 'foreign-request' },
    { ...response, generationRequestId: 'foreign-request' },
  ])('rejects invalid initial identity/order and detaches without a server stop', async (event) => {
    const h = harness(); const promise = h.start(); const rejected = expect(promise).rejects.toBeInstanceOf(ArenaHostedBridgeError);
    h.channel.onmessage(event); await rejected; h.resolve();
    expect(h.invoke.mock.calls.map(([command]) => command)).toEqual([ARENA_HOSTED_STREAM_COMMAND, ARENA_HOSTED_DETACH_COMMAND]);
  });
  it('does not turn a truncated last fragment or an invoke completion into an SSE terminal', async () => {
    const h = harness(); const promise = h.start(); h.channel.onmessage(response); const res = await promise;
    const read = expect(res.text()).rejects.toBeInstanceOf(ArenaHostedBridgeError);
    h.send(1, { kind: 'sse-fragment', text: block().slice(0, -1), final: false }); h.resolve(); await read;
  });
  it('rejects duplicate sequence and malformed complete SSE before enqueueing any unvalidated bytes', async () => {
    for (const text of [block().slice(0, -1), 'id: 1-0\nevent: markdown\ndata: {}\n\n']) {
      const h = harness(); const promise = h.start(); h.channel.onmessage(response); const res = await promise;
      const read = expect(res.text()).rejects.toBeInstanceOf(ArenaHostedBridgeError);
      h.send(1, { kind: 'sse-fragment', text, final: true }); await read; h.resolve();
    }
    const h = harness(); const promise = h.start(); h.channel.onmessage(response); const res = await promise;
    const read = expect(res.text()).rejects.toBeInstanceOf(ArenaHostedBridgeError); h.send(0, { kind: 'stream-end' }); await read; h.resolve();
  });
  it('preserves a safe non-success body for C0 recovery decisions', async () => {
    const h = harness(); const promise = h.start(); h.channel.onmessage({ ...response, status: 503, body: { code: 'SERVICE_UNAVAILABLE', error: '稍后恢复' } });
    const res = await promise; h.send(1, { kind: 'stream-end' }); h.resolve();
    expect(res.status).toBe(503); expect(await res.json()).toEqual({ code: 'SERVICE_UNAVAILABLE', error: '稍后恢复' });
  });
  it('distinguishes proven pre-dispatch rejection and unknown transport failure without echoing raw errors', async () => {
    for (const cause of [
      { code: 'capability-unavailable', dispatchState: 'not-dispatched', intentOwnership: 'current-owned', message: 'secret-canary' },
      new Error('secret-canary'),
    ]) {
      const h = harness(); const promise = h.start(); const observed = promise.catch((error: unknown) => error);
      h.reject(cause); const error = await observed as ArenaHostedBridgeError;
      expect(error.message).not.toContain('secret-canary');
      expect(error.dispatchState).toBe(cause instanceof Error ? 'unknown' : 'not-dispatched');
    }
  });
  it('aborts only the local subscription, ignores late callbacks, and never dispatches if already aborted', async () => {
    const h = harness(); const controller = new AbortController(); const promise = h.start(controller.signal);
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    h.channel.onmessage(response); h.send(1, { kind: 'stream-end' }); h.resolve();
    expect(h.invoke.mock.calls.map(([command]) => command)).toEqual([ARENA_HOSTED_STREAM_COMMAND, ARENA_HOSTED_DETACH_COMMAND]);
    const next = harness(); await expect(next.start(controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(next.invoke).not.toHaveBeenCalled();
  });
  it('reassembles a full four-MiB escaped payload without lowering the original body budget', async () => {
    const h = harness(); const promise = h.start(); h.channel.onmessage(response); const res = await promise;
    const source = block('markdown', { chunk: '\u0000'.repeat(4 * 1024 * 1024) });
    let sequence = 1;
    for (let offset = 0; offset < source.length; offset += 65536) {
      h.send(sequence++, { kind: 'sse-fragment', text: source.slice(offset, offset + 65536), final: offset + 65536 >= source.length });
    }
    h.send(sequence, { kind: 'stream-end' }); h.resolve(); expect(await res.text()).toBe(source);
  });
  it('rejects SSE fragments attached to a non-success JSON response', async () => {
    const h = harness(); const promise = h.start(); h.channel.onmessage({ ...response, status: 503, body: { code: 'SERVICE_UNAVAILABLE' } });
    expect((await promise).status).toBe(503); h.send(1, { kind: 'sse-fragment', text: block(), final: true }); h.resolve();
    expect(h.invoke.mock.calls.map(([command]) => command)).toContain(ARENA_HOSTED_DETACH_COMMAND);
  });
  it('validates the finite short control reply and sanitizes IPC failures', async () => {
    const invoke = vi.fn(async () => ({ status: 202, body: { status: 'cancelling' }, recoveryCredentialState: 'stored' }));
    const scope = { product: request.product, requestId: request.requestId, actor: request.actor };
    expect(await controlArenaHosted(invoke, { operation: 'stop', ...scope, reason: 'user' })).toMatchObject({ status: 202, body: { status: 'cancelling' } });
    expect(invoke).toHaveBeenCalledWith(ARENA_HOSTED_CONTROL_COMMAND, { request: { operation: 'stop', ...scope, reason: 'user' } });
    await expect(controlArenaHosted(async () => ({ status: 200, body: { token: 'canary' }, recoveryCredentialState: 'stored' }), { operation: 'lookup-request', ...scope })).rejects.toBeInstanceOf(ArenaHostedBridgeError);
  });
});

const nativeChannelFixture = process.env.MAHO_ARENA_HOSTED_NATIVE_CHANNEL_FIXTURE;
it.skipIf(!nativeChannelFixture)('consumes the unchanged real Rust HTTP-to-Channel maximum snapshot through the product bridge', async () => {
  const events: Record<string, unknown>[] = JSON.parse(readFileSync(nativeChannelFixture!, 'utf8'));
  expect(events).toHaveLength(388);
  expect(events[0]).toMatchObject({ kind: 'response', sequence: 0, status: 200 });
  expect(events.at(-1)).toMatchObject({ kind: 'stream-end', sequence: 387 });
  const channel: ArenaHostedChannel = { onmessage: () => undefined };
  const invoke = vi.fn(async (command: string) => {
    if (command !== ARENA_HOSTED_STREAM_COMMAND) throw new Error('unexpected command');
    for (const event of events) channel.onmessage(event);
  });
  const nativeRequest = { ...request, requestId: events[0]!.requestId };
  const res = await openArenaHostedStream(invoke, DesktopArenaHostedStreamRequestSchema.parse(nativeRequest), { createChannel: () => channel });
  const text = await res.text();
  const blocks = text.split('\n\n').filter(Boolean).map((block) => parseDesktopArenaHostedSseBlock(`${block}\n\n`));
  expect(blocks).toHaveLength(2);
  expect(blocks[0]!.event).toBe('snapshot');
  if (blocks[0]!.event !== 'snapshot') throw new Error('missing snapshot');
  expect(blocks[0]!.data.markdown.length).toBe(4 * 1024 * 1024);
  expect([...new Set(blocks[0]!.data.markdown)]).toEqual(['\u0001']);
  expect(blocks[1]).toMatchObject({ event: 'done', data: { status: 'completed', ok: true } });
  expect(invoke).toHaveBeenCalledTimes(1);
});


it.each(['none', 'unavailable', 'available', 'expired'] as const)('validates read-only recovery hint %s without any generation operation', async (state) => {
  const value = state === 'available' || state === 'expired' ? { product: 'battle', state, requestId: 'original-request-0001', actorKind: 'anonymous' } : { product: 'battle', state };
  const invoke = vi.fn(async () => value); expect(await readArenaHostedRecoveryHint(invoke, { product: 'battle' })).toEqual(value);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('arena_hosted_recovery_hint', { request: { product: 'battle' } });
});
it.each([{ product: 'arena', state: 'none' }, { product: 'battle', state: 'available' }, { product: 'battle', state: 'none', requestId: 'invented-request-0001' }, { product: 'battle', state: 'available', requestId: 'original-request-0001', actorKind: 'anonymous', token: 'secret-canary' }])('rejects cross-product or excess recovery hint data', async (value) => {
  await expect(readArenaHostedRecoveryHint(async () => value, { product: 'battle' })).rejects.toMatchObject({ code: 'protocol' });
});


const nativeMetaFixture = process.env.MAHO_ARENA_HOSTED_NATIVE_META_FIXTURE;
it.skipIf(!nativeMetaFixture)('preserves the unchanged real Rust HTTP-to-Channel maximum meta through the product bridge', async () => {
  const events: Record<string, unknown>[] = JSON.parse(readFileSync(nativeMetaFixture!, 'utf8'));
  const expected = parseDesktopArenaHostedSseBlock(readFileSync(join(dirname(nativeMetaFixture!), 'real-meta.sse'), 'utf8'));
  expect(events).toHaveLength(68);
  const channel: ArenaHostedChannel = { onmessage: () => undefined };
  const invoke = vi.fn(async (command: string) => {
    if (command !== ARENA_HOSTED_STREAM_COMMAND) throw new Error('unexpected command');
    for (const event of events) channel.onmessage(event);
  });
  const response = await openArenaHostedStream(invoke, DesktopArenaHostedStreamRequestSchema.parse({ ...request, requestId: events[0]!.requestId }), { createChannel: () => channel });
  const text = await response.text(), rawBlocks = text.split('\n\n').filter(Boolean);
  const blocks = rawBlocks.map(block => parseDesktopArenaHostedSseBlock(`${block}\n\n`));
  expect(blocks).toHaveLength(2); expect(isDeepStrictEqual(blocks[0], expected)).toBe(true);
  expect(new TextEncoder().encode(`${rawBlocks[0]}\n\n`).byteLength).toBe(4_202_360);
  expect(blocks[1]).toMatchObject({ event: 'done', data: { status: 'completed', ok: true } });
  expect(invoke).toHaveBeenCalledTimes(1);
});
