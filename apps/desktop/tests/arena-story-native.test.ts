import { describe, expect, it, vi } from 'vitest';
import { createIpcStoryNativePort, createIpcStoryMarkdownExportPort, STORY_IPC, type StoryInvoke } from '../src/platform/arena-story-native';
import type { StoryRecordDescriptor } from '@mahoshojo/contracts/desktop-arena-story';

const token = `${'a'.repeat(32)}-${'b'.repeat(32)}`;
const descriptor: StoryRecordDescriptor = { instance: 'a'.repeat(32), sessionId: 'session', recordId: 'chapter', revision: 1, kind: 'chapter', byteLength: 3, digest: `sha256:${'0'.repeat(64)}` };
describe('actual story IPC binder', () => {
  it('sends only raw bytes with fixed token/kind/canonical offset headers', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => ({})); const port = createIpcStoryNativePort(invoke);
    const bytes = new Uint8Array([0, 128, 255]);
    await port.append(token, 'chapter', 0, bytes);
    expect(invoke).toHaveBeenCalledWith(STORY_IPC.append, bytes, { headers: { 'x-story-token': token, 'x-story-part': 'chapter', 'x-story-offset': '0' } });
    expect(() => port.append(token, 'chapter', -1, bytes)).toThrow();
    expect(() => port.append(token, 'chapter', 0, new Uint8Array(4 * 1024 * 1024 + 1))).toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('uses fixed descriptor reads and rejects JSON/base64/oversized binary responses', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => new Uint8Array([1, 2, 3]).buffer); const port = createIpcStoryNativePort(invoke);
    expect(await port.read(descriptor, 0, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(invoke).toHaveBeenLastCalledWith(STORY_IPC.read, { descriptor, offset: 0, length: 3 });
    for (const wrong of [[1, 2, 3], 'AQID', new Uint8Array(4).buffer]) {
      invoke.mockResolvedValueOnce(wrong); await expect(port.read(descriptor, 0, 3)).rejects.toThrow();
    }
  });
  it('keeps export count declaration and final raw SHA in separate fixed operations', async () => {
    const invoke = vi.fn<StoryInvoke>(async () => ({})); const sink = createIpcStoryMarkdownExportPort(invoke);
    const manifest = { sessionId: 'session', revision: 1, expectedHead: 'chapter', chapterCount: 1, expectedByteLength: 3 };
    await sink.begin(manifest); await sink.append(token, 0, new Uint8Array([1, 2, 3])); await sink.end(token, descriptor.digest); await sink.abort(token);
    expect(invoke.mock.calls[0]).toEqual([STORY_IPC.exportBegin, { manifest }]);
    expect(invoke.mock.calls[1]![2]).toEqual({ headers: { 'x-story-token': token, 'x-story-offset': '0' } });
    expect(invoke.mock.calls[2]).toEqual([STORY_IPC.exportEnd, { token, expectedDigest: descriptor.digest }]);
    expect(invoke.mock.calls[3]).toEqual([STORY_IPC.exportAbort, { token }]);
  });
});
