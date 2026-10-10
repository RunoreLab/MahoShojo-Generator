import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ARENA_COMPANION_PROTOCOL_VERSION, ArenaCompanionEnvelopeSchema } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedJsonCreateRequestSchema } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import {
  ARENA_HOSTED_STREAM_COMMAND, ARENA_HOSTED_DETACH_COMMAND, ArenaHostedBridgeError,
  type ArenaHostedChannel,
} from '../src/platform/arena-hosted-bridge';
import { openArenaHostedJson } from '../src/platform/arena-hosted-json-bridge';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-arena-hosted.json', import.meta.url), 'utf8'));
const request = DesktopArenaHostedJsonCreateRequestSchema.parse({ ...fixture.validOperations[0], operation: 'create-json' });
const generationId = `arena_${'a'.repeat(64)}`;
const envelope = () => ArenaCompanionEnvelopeSchema.parse({ version: ARENA_COMPANION_PROTOCOL_VERSION,
  body: { generationId, updatedCombatants: [], report: {
    headline: '完整标题', reporterInfo: { name: '记者', publication: '刊物' },
    article: { body: '完整正文 😀 \\ 原样保留', analysis: '分析' }, officialReport: { winner: '甲', conclusion: '结论' }, mode: 'classic',
    aiReasoning: { status: 'complete', text: '独立 reasoning' },
  } }, metadata: { reportFormat: 'markdown', outputContract: 'structured-report', mode: 'classic',
    language: 'zh-CN', storyLength: 'medium', scenarioDisplayName: '源情景' } });
const response = { kind: 'json-response', requestId: request.requestId, sequence: 0, status: 200, generationId,
  generationRequestId: request.requestId, recoveryCredentialState: 'stored' };
function harness() {
  const channel: ArenaHostedChannel = { onmessage: () => undefined };
  let resolve!: () => void, reject!: (value: unknown) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const invoke = vi.fn(async (command: string) => command === ARENA_HOSTED_STREAM_COMMAND ? pending : undefined);
  const onResponse = vi.fn();
  const start = (signal?: AbortSignal) => openArenaHostedJson(invoke, request, { signal, onResponse, createChannel: () => channel });
  const send = (sequence: number, value: Record<string, unknown>) => channel.onmessage({ requestId: request.requestId, sequence, ...value });
  return { invoke, start, send, resolve, reject, channel, onResponse };
}

describe('complete Arena companion Native bridge', () => {
  it('publishes a handshake but no result until one fully validated JSON and explicit end', async () => {
    const h = harness(); const promise = h.start(); const observed = vi.fn(); void promise.then(observed);
    h.channel.onmessage(response);
    const source = envelope(), raw = JSON.stringify(source);
    h.send(1, { kind: 'json-fragment', text: raw.slice(0, 43), final: false });
    await Promise.resolve(); expect(observed).not.toHaveBeenCalled(); expect(h.onResponse).toHaveBeenCalledOnce();
    h.send(2, { kind: 'json-fragment', text: raw.slice(43), final: true });
    await Promise.resolve(); expect(observed).not.toHaveBeenCalled();
    h.send(3, { kind: 'json-end' }); h.resolve();
    const value = await promise; expect(value.envelope).toEqual(source);
    expect(Object.keys(value)).toEqual(['response', 'envelope']);
    expect(h.invoke.mock.calls.map(([command]) => command)).toEqual([ARENA_HOSTED_STREAM_COMMAND]);
  });
  it.each([
    { kind: 'json-fragment', text: '{}', final: true, sequence: 0 },
    { ...response, sequence: 1 },
    { ...response, requestId: 'foreign-request' },
    { ...response, generationRequestId: 'foreign-request' },
    { ...response, generationId: undefined },
    { ...response, generationRequestId: undefined },
  ])('rejects bad order or incomplete/mismatched success identity', async (event) => {
    const h = harness(); const promise = h.start(); const rejected = expect(promise).rejects.toBeInstanceOf(ArenaHostedBridgeError);
    h.channel.onmessage(event); await rejected; h.resolve();
    expect(h.invoke.mock.calls.map(([command]) => command)).toEqual([ARENA_HOSTED_STREAM_COMMAND, ARENA_HOSTED_DETACH_COMMAND]);
  });
  it('never treats early invoke completion, incomplete fragments, or end without final as a completed report', async () => {
    for (const early of ['invoke', 'end'] as const) {
      const h = harness(); const rejected = expect(h.start()).rejects.toBeInstanceOf(ArenaHostedBridgeError);
      h.channel.onmessage(response); h.send(1, { kind: 'json-fragment', text: '{"version":', final: false });
      if (early === 'invoke') h.resolve(); else h.send(2, { kind: 'json-end' });
      await rejected; h.resolve();
    }
  });
  it('rejects malformed or wrong-generation complete output and raw error fields', async () => {
    for (const transform of [
      () => '{',
      () => JSON.stringify({ ...envelope(), body: { ...envelope().body, generationId: `arena_${'b'.repeat(64)}` } }),
      () => JSON.stringify({ ...envelope(), transportSecret: 'secret-canary' }),
    ]) {
      const h = harness(); const rejected = expect(h.start()).rejects.toBeInstanceOf(ArenaHostedBridgeError);
      h.channel.onmessage(response); h.send(1, { kind: 'json-fragment', text: transform(), final: true });
      await rejected; h.resolve();
    }
  });
  it('rejects another fragment after a checked final and a duplicate response', async () => {
    for (const extraResponse of [true, false]) {
      const h = harness(); const rejected = expect(h.start()).rejects.toBeInstanceOf(ArenaHostedBridgeError);
      h.channel.onmessage(response);
      if (extraResponse) h.channel.onmessage({ ...response, sequence: 1 });
      else {
        h.send(1, { kind: 'json-fragment', text: JSON.stringify(envelope()), final: true });
        h.send(2, { kind: 'json-fragment', text: ' ', final: true });
      }
      await rejected; h.resolve();
    }
  });
  it('accepts an explicitly checked error envelope without creating a fake successful report', async () => {
    const h = harness(); const promise = h.start(); h.channel.onmessage({ ...response, status: 502 });
    const failure = { version: ARENA_COMPANION_PROTOCOL_VERSION, body: {
      code: 'ARENA_COMPANION_PROTOCOL_UNSUPPORTED', generationId, error: '附加数据不受支持' }, metadata: null };
    h.send(1, { kind: 'json-fragment', text: JSON.stringify(failure), final: true }); h.send(2, { kind: 'json-end' }); h.resolve();
    expect(await promise).toMatchObject({ response: { status: 502 }, envelope: failure });
  });
  it('aborts only the local delivery, drops late replies and never starts an already-aborted create', async () => {
    const h = harness(); const abort = new AbortController(); const rejected = expect(h.start(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    h.channel.onmessage(response); abort.abort(); await rejected;
    h.send(1, { kind: 'json-fragment', text: JSON.stringify(envelope()), final: true }); h.send(2, { kind: 'json-end' }); h.resolve();
    expect(h.invoke.mock.calls.map(([command]) => command)).toEqual([ARENA_HOSTED_STREAM_COMMAND, ARENA_HOSTED_DETACH_COMMAND]);
    const before = harness(); await expect(before.start(abort.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(before.invoke).not.toHaveBeenCalled();
  });
  it('preserves checked Native ownership proof and never exposes an unknown raw failure message', async () => {
    for (const cause of [new Error('secret-canary'), { code: 'capability-unavailable', message: 'secret-canary', dispatchState: 'not-dispatched', intentOwnership: 'prior-retained' }]) {
      const h = harness(); const observed = h.start().catch((value: unknown) => value);
      h.reject(cause); const error = await observed as ArenaHostedBridgeError;
      expect(error.message).not.toContain('secret-canary');
      expect(error.intentOwnership).toBe(cause instanceof Error ? 'unknown' : 'prior-retained');
      expect(error.dispatchState).toBe(cause instanceof Error ? 'unknown' : 'not-dispatched');
    }
  });
});
