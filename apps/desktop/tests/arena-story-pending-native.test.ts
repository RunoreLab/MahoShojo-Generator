import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { STORY_CANDIDATE_FRAME_BYTES, type StoryPendingKey, type StoryPendingManifest, type StoryPendingPartKind } from '@mahoshojo/contracts/desktop-arena-story';
import { createIpcStoryPendingPort, STORY_PENDING_IPC } from '../src/platform/arena-story-pending-native';
import { STORY_IPC, type StoryInvoke } from '../src/platform/arena-story-native';

const token = `${'a'.repeat(32)}-${'b'.repeat(32)}`;
const digest = `sha256:${'0'.repeat(64)}`;
const key: StoryPendingKey = { product: 'battle', requestId: 'story_request_1234', pendingRevision: 1 };
const manifest: StoryPendingManifest = {
  version: 1, ...key, actor: { kind: 'account', expectedUserId: 42 }, sessionId: 'session', operationId: 'chapter',
  outputCheckpointId: 'after', initialCheckpointId: 'before', createdAt: 123, expectedRevision: 0,
  expectedLastChapterId: null, lastInputCheckpointId: 'before', inputDigest: digest,
  writeOptions: { writeArenaHistory: true, writeCurrentState: true, writeNarrativeHistory: false },
  modelCompleted: false, roleState: 'not-requested', roleInputDigest: null,
  parts: [{ kind: 'input', byteLength: 3, digest }], commitManifest: null,
};

const rawCarriers = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-story-pending-content.json', import.meta.url), 'utf8')) as {
  invalidRawCarriers: Array<{ name: string; kind: StoryPendingPartKind; document: string }>;
  validOpaqueRawInput: string;
};

describe('storage-only durable pending raw IPC bridge', () => {
  // The same raw fixtures run through real SQLite Native append/reopen tests.
  // The bridge transports bytes; it must not JSON.parse/stringify away duplicates.
  it.each(rawCarriers.invalidRawCarriers)('$name forwards the negative Native golden byte-for-byte and preserves rejection', async ({ kind, document }) => {
    const failure = { code: 'story-invalid', message: 'invalid', writeEvidence: 'not-written' };
    const invoke = vi.fn<StoryInvoke>().mockRejectedValueOnce(failure);
    const port = createIpcStoryPendingPort(invoke);
    const bytes = new TextEncoder().encode(document);
    await expect(port.append(token, kind, 0, bytes)).rejects.toBe(failure);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(STORY_PENDING_IPC.append, bytes, {
      headers: { 'x-story-token': token, 'x-story-part': kind, 'x-story-offset': '0' },
    });
    expect(invoke.mock.calls[0]![1]).toBe(bytes);
    expect(new TextDecoder().decode(invoke.mock.calls[0]![1] as Uint8Array)).toBe(document);
  });
  it('transports the positive opaque duplicate-key and lone-surrogate golden without normalization', async () => {
    const bytes = new TextEncoder().encode(rawCarriers.validOpaqueRawInput);
    const invoke = vi.fn<StoryInvoke>(async () => ({ token, kind: 'input', receivedBytes: bytes.length }));
    await createIpcStoryPendingPort(invoke).append(token, 'input', 0, bytes);
    expect(invoke.mock.calls[0]![1]).toBe(bytes);
    expect(new TextDecoder().decode(invoke.mock.calls[0]![1] as Uint8Array)).toBe(rawCarriers.validOpaqueRawInput);
  });
  it('uses exact fixed commands, keys and explicit save attempt without creating a Direct save stage', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => ({})); const port = createIpcStoryPendingPort(invoke);
    await port.begin(manifest); await port.queryUpload(token); await port.seal(token); await port.abortUpload(token);
    await port.describe('battle'); await port.prepareSave(key, digest); await port.save(key, digest, token);
    await port.receipt('session', 'chapter');
    expect(invoke.mock.calls).toEqual([
      [STORY_PENDING_IPC.begin, { manifest }], [STORY_PENDING_IPC.queryUpload, { token }],
      [STORY_PENDING_IPC.seal, { token }], [STORY_PENDING_IPC.abortUpload, { token }],
      [STORY_PENDING_IPC.describe, { product: 'battle' }],
      [STORY_PENDING_IPC.prepareSave, { key, wireDigest: digest }],
      [STORY_PENDING_IPC.save, { key, wireDigest: digest, attemptId: token }],
      [STORY_IPC.receipt, { sessionId: 'session', operationId: 'chapter' }],
    ]);
    expect(Object.keys(port)).toEqual(['begin', 'append', 'queryUpload', 'seal', 'abortUpload', 'describe', 'read', 'prepareSave', 'save', 'receipt']);
    expect(invoke.mock.calls.some(([command]) => [STORY_IPC.begin, STORY_IPC.append, STORY_IPC.end].includes(command as typeof STORY_IPC.begin))).toBe(false);
  });
  it('sends identical raw bytes with fixed ASCII-only identity and canonical offset headers', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => ({ token, kind: 'input', receivedBytes: 3 })); const port = createIpcStoryPendingPort(invoke);
    const bytes = new Uint8Array([0, 128, 255]);
    expect(await port.append(token, 'input', 3, bytes)).toEqual({ token, kind: 'input', receivedBytes: 3 });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(STORY_PENDING_IPC.append, bytes, {
      headers: { 'x-story-token': token, 'x-story-part': 'input', 'x-story-offset': '3' },
    });
    expect(invoke.mock.calls[0]![1]).toBe(bytes);
  });
  it('rejects unknown control fields and header injection before invoking Native', () => {
    const invoke = vi.fn<StoryInvoke>(); const port = createIpcStoryPendingPort(invoke);
    expect(() => port.begin({ ...manifest, apiKey: 'secret' } as StoryPendingManifest)).toThrow();
    expect(() => port.append(`${token}\r\nx-other: secret`, 'input', 0, new Uint8Array([1]))).toThrow();
    expect(() => port.append(token, 'customProvider' as StoryPendingPartKind, 0, new Uint8Array([1]))).toThrow();
    expect(() => port.queryUpload('wrong-token')).toThrow();
    expect(() => port.seal('wrong-token')).toThrow();
    expect(() => port.describe('custom' as 'battle')).toThrow();
    expect(() => port.prepareSave({ ...key, actor: manifest.actor } as StoryPendingKey, digest)).toThrow();
    expect(() => port.prepareSave(key, 'wrong-digest')).toThrow();
    expect(() => port.save(key, digest, 'wrong-token')).toThrow();
    expect(() => port.receipt('../session', 'chapter')).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe frame offset %s', async (offset) => {
    const invoke = vi.fn<StoryInvoke>(); const port = createIpcStoryPendingPort(invoke);
    expect(() => port.append(token, 'input', offset, new Uint8Array([1]))).toThrow();
    await expect(port.read(key, 'input', offset, 1)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('enforces raw frame lengths on both read and append', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => new Uint8Array([1]).buffer); const port = createIpcStoryPendingPort(invoke);
    expect(() => port.append(token, 'input', 0, new Uint8Array(0))).toThrow();
    expect(() => port.append(token, 'input', 0, new Uint8Array(STORY_CANDIDATE_FRAME_BYTES + 1))).toThrow();
    for (const length of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, STORY_CANDIDATE_FRAME_BYTES + 1]) {
      await expect(port.read(key, 'input', 0, length)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
    await port.append(token, 'input', 0, new Uint8Array(STORY_CANDIDATE_FRAME_BYTES));
    expect(await port.read(key, 'input', 0, STORY_CANDIDATE_FRAME_BYTES)).toEqual(new Uint8Array([1]));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('reads the exact pending revision as bounded binary without accepting JSON or base64', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => new Uint8Array([0, 128, 255]).buffer); const port = createIpcStoryPendingPort(invoke);
    expect(await port.read(key, 'input', 0, 3)).toEqual(new Uint8Array([0, 128, 255]));
    expect(invoke).toHaveBeenCalledWith(STORY_PENDING_IPC.read, { key, kind: 'input', offset: 0, length: 3 });
    for (const value of [[0, 128, 255], 'AID/', new Uint8Array([0, 128, 255]), new ArrayBuffer(0), new ArrayBuffer(4)]) {
      invoke.mockResolvedValueOnce(value);
      await expect(port.read(key, 'input', 0, 3)).rejects.toThrow();
    }
  });
  it('never retries an uncertain append, seal, prepare or save, or swallows write evidence', async () => {
    const invoke = vi.fn<StoryInvoke>(); const port = createIpcStoryPendingPort(invoke);
    const unknown = { code: 'story-commit-unknown', message: 'unknown', writeEvidence: 'unknown' };
    const io = { code: 'story-io', message: 'not written', writeEvidence: 'not-written' };
    const calls = [
      () => port.append(token, 'input', 0, new Uint8Array([1])), () => port.seal(token),
      () => port.prepareSave(key, digest), () => port.save(key, digest, token),
    ];
    for (const call of calls) for (const failure of [unknown, io, new Error('IPC disconnected')]) {
      invoke.mockRejectedValueOnce(failure); const before = invoke.mock.calls.length;
      await expect(call()).rejects.toBe(failure);
      expect(invoke.mock.calls.length).toBe(before + 1);
    }
    expect(invoke.mock.calls.some(([command]) => command === STORY_IPC.receipt || command === STORY_PENDING_IPC.abortUpload)).toBe(false);
  });
  it('does not treat absent or malformed receipt evidence as permission to prepare/save again', async () => {
    const invoke = vi.fn<StoryInvoke>(); const port = createIpcStoryPendingPort(invoke);
    for (const response of [null, { operationId: 'other', wireDigest: digest }, { error: 'not-found' }]) {
      invoke.mockResolvedValueOnce(response);
      expect(await port.receipt('session', 'chapter')).toBe(response);
    }
    expect(invoke.mock.calls).toEqual(Array.from({ length: 3 }, () => [STORY_IPC.receipt, { sessionId: 'session', operationId: 'chapter' }]));
  });
});
