import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCompletedBattleStoryRecords, digestBattleStoryCommitValue, prepareBattleStoryCommitJson } from '@mahoshojo/domain/arena-story-commit';
import { projectBattleStoryPromptWindowItem, resolveBattleStoryRecentWindow } from '@mahoshojo/domain/arena-battle-story-session';
import { StoryCommitManifestSchema, type StoryCommitManifest, type StoryRecordDescriptor, type StorySessionHead } from '@mahoshojo/contracts/desktop-arena-story';
import {
  prepareStoryStorageCommit, queryStoryCommitReceipt, readAllCommittedStoryChapters, readSelectedStoryChapter,
  savePreparedStoryCommit, StorySaveError, storyWireDigest, exportCommittedStoryMarkdown, type StoryMarkdownExportPort, type PreparedStoryCommit, type StoryNativePort,
} from '../src/platform/arena-story-storage';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const token = `${'a'.repeat(32)}-${'b'.repeat(32)}`;
const encode = (text: string) => new TextEncoder().encode(text);
const bytesDigest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const records = (index = 1, sessionId = 'story') => {
  const combatants = [{ data: { name: '角色🙂', arena_history: { entries: [{ id: 1, extension: { signature: 'keep-user-nested' } }] }, unknown: { preserved: true } } }];
  return buildCompletedBattleStoryRecords({
    action: index === 1 ? 'start' : 'continue',
    session: {
      id: sessionId, title: '故事', createdAt: 100, updatedAt: 100, source: { mode: 'classic', language: 'zh-CN', storyLength: 'default', generationMode: 'stream', providerMode: 'direct', providerId: 'fixed', modelId: 'model', apiKey: 'must-not-transmit', auth: { token: 'must-not-transmit' } } as Record<string, unknown>,
      seed: { combatants, settings: { writeArenaHistory: true }, unknown: '完整种子' }, workingCombatants: combatants,
      chapterCount: index - 1, ...(index > 1 ? { lastChapterId: `${sessionId}-chapter-${index - 1}` } : {}),
      extension: { preserve: 'unrecognized' }, sessionSummary: '完整摘要',
    },
    operationId: `${sessionId}-chapter-${index}`, checkpointId: `${sessionId}-checkpoint-${index}`,
    ...(index === 1 ? { initialCheckpointId: `${sessionId}-checkpoint-0` } : {}), now: 99 + index,
    source: { mode: 'classic', language: 'zh-CN', storyLength: 'default', generationMode: 'stream', providerId: 'fixed', modelId: 'model' },
    inputCombatants: combatants,
    generated: { chapterIndex: index, markdown: '正文𠮷🙂\u0000\ud800', reportJson: { extra: { original: true } }, digest: { chapterTitle: '标题\ud800' }, nextWorkingCombatants: combatants, cardSnapshot: { original: '保真' } },
  });
};
const prepare = (index = 1) => prepareStoryStorageCommit({ ...records(index), expectedRevision: index - 1, expectedLastChapterId: index === 1 ? null : `story-chapter-${index - 1}`, ...(index > 1 ? { lastInputCheckpointId: `story-checkpoint-${index - 1}` } : {}) });
const receipt = (commit: PreparedStoryCommit) => ({ version: 1, operationId: commit.manifest.operationId, sessionId: commit.manifest.sessionId,
  chapterId: commit.manifest.operationId, chapterIndex: Number((commit.parts.at(-1)!.prepared.value as { boundaryIndex: number }).boundaryIndex),
  chapterCount: Number((commit.parts.at(-1)!.prepared.value as { boundaryIndex: number }).boundaryIndex), revision: commit.manifest.expectedRevision + 1,
  checkpointIds: commit.parts.filter((part) => part.kind.startsWith('checkpoint')).map((part) => (part.prepared.value as { id: string }).id), wireDigest: commit.wireDigest });
const portFor = (commit: PreparedStoryCommit): StoryNativePort => ({
  begin: vi.fn(async (manifest: StoryCommitManifest) => ({ token, totalBytes: manifest.parts.reduce((sum, part) => sum + part.byteLength, 0) })),
  append: vi.fn(async (_token, kind, offset, bytes) => ({ token: _token, kind, receivedBytes: offset + bytes.length })),
  end: vi.fn(async () => receipt(commit)), abort: vi.fn(async () => {}), receipt: vi.fn(async () => null),
  listSessions: vi.fn(), listChapters: vi.fn(), describe: vi.fn(), read: vi.fn(), continueState: vi.fn(),
});

describe('internal story storage candidate', () => {
  it('uses shared records, stores checkpoints once, preserves extensions and omits connection secrets', async () => {
    const input = records();
    input.session.source = { ...input.session.source, apiKey: 'secret', auth: { bearer: 'secret' }, endpoint: 'https://private.invalid' };
    const result = await prepareStoryStorageCommit({ ...input, expectedRevision: 0, expectedLastChapterId: null });
    expect(result.parts.map((part) => part.kind)).toEqual(['session', 'seed', 'chapter', 'checkpoint0', 'checkpoint1']);
    const stored = result.parts[0]!.prepared.value as Record<string, unknown>;
    expect(stored).not.toHaveProperty('workingCombatants'); expect(stored).not.toHaveProperty('lastChapterInputCombatants'); expect(stored).not.toHaveProperty('seed');
    expect(stored.extension).toEqual(input.session.extension);
    expect(stored.source).not.toHaveProperty('apiKey'); expect(stored.source).not.toHaveProperty('auth'); expect(stored.source).not.toHaveProperty('endpoint');
    for (const part of result.parts) {
      const chunks = [...part.prepared.chunks(7)];
      const bytes = Buffer.concat(chunks); const parsed = JSON.parse(bytes.toString());
      expect(bytes.length).toBe(part.prepared.byteLength); expect(bytesDigest(bytes)).toBe(part.prepared.contentDigest);
      expect(digestBattleStoryCommitValue(parsed)).toBe(digestBattleStoryCommitValue(part.prepared.value));
    }
    expect((result.parts[2]!.prepared.value as { title: string; titlePreview: string }).title).toBe('标题\ud800');
    expect((result.parts[2]!.prepared.value as { titlePreview: string }).titlePreview).toBe('标题�');
  });
  it('exact whole-record total limit and +1 before any transport or amplified clone', async () => {
    const first = await prepare();
    expect((await prepareStoryStorageCommit({ ...records(), expectedRevision: 0, expectedLastChapterId: null }, first.byteLength)).byteLength).toBe(first.byteLength);
    await expect(prepareStoryStorageCommit({ ...records(), expectedRevision: 0, expectedLastChapterId: null }, first.byteLength - 1)).rejects.toMatchObject({ code: 'story-commit-too-large' });
    const port = portFor(first); expect(port.begin).not.toHaveBeenCalled();
  });
  it('wire identity binds operation, CAS and every actual byte digest; separate from domain logical digest', async () => {
    const value = await prepare();
    const sorted = JSON.parse(JSON.stringify(value.manifest), (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    expect(value.wireDigest).toBe(bytesDigest(encode(`arena-story-wire-v1\n${JSON.stringify(sorted)}`)));
    expect(await storyWireDigest({ ...value.manifest, operationId: 'different' })).not.toBe(value.wireDigest);
    expect(value.wireDigest).not.toBe(digestBattleStoryCommitValue(value.manifest));
  });
  it('uploads same frozen parts in order with exact offsets and compact receipt, no full JSON IPC', async () => {
    const commit = await prepare(); const port = portFor(commit);
    expect(await savePreparedStoryCommit(port, commit)).toEqual(receipt(commit));
    expect(port.end).toHaveBeenCalledTimes(1); expect(port.abort).toHaveBeenCalledWith(token);
    expect(Object.isFrozen(commit.manifest.parts)).toBe(true); expect(Object.isFrozen(commit.manifest.parts[0])).toBe(true); expect(Object.isFrozen(commit.parts[0])).toBe(true);
    const calls = vi.mocked(port.append).mock.calls;
    expect(calls.map((call) => call[1])).toEqual(commit.parts.map((part) => part.kind));
    for (let i = 0; i < calls.length; i++) { expect(calls[i]![2]).toBe(0); expect(bytesDigest(calls[i]![3])).toBe(commit.parts[i]!.prepared.contentDigest); }
  });
  it('lost end response resolves only exact persisted operation receipt', async () => {
    const commit = await prepare(); const port = portFor(commit);
    vi.mocked(port.end).mockRejectedValue(new Error('lost response'));
    vi.mocked(port.receipt).mockResolvedValueOnce(null).mockResolvedValue(receipt(commit));
    expect(await savePreparedStoryCommit(port, commit)).toEqual(receipt(commit)); expect(port.begin).toHaveBeenCalledTimes(1); expect(port.end).toHaveBeenCalledTimes(1);
  });
  it('unknown outcome never downgrades or resurrects on later missing receipt', async () => {
    const commit = await prepare(); const port = portFor(commit);
    vi.mocked(port.end).mockRejectedValue(new Error('lost response'));
    await expect(savePreparedStoryCommit(port, commit)).rejects.toMatchObject({ evidence: 'unknown' });
    vi.mocked(port.begin).mockClear();
    await expect(savePreparedStoryCommit(port, commit, 'unknown')).rejects.toMatchObject({ evidence: 'unknown' });
    expect(port.begin).not.toHaveBeenCalled();
    vi.mocked(port.receipt).mockRejectedValue(new Error('read failure'));
    await expect(savePreparedStoryCommit(port, commit, 'unknown')).rejects.toMatchObject({ evidence: 'unknown' });
  });
  it('returned native maintenance/IO failures remain safely retryable while transport failures do not', async () => {
    for (const code of ['maintenance-busy', 'story-io']) {
      const commit = await prepare(); const port = portFor(commit);
      vi.mocked(port.end).mockRejectedValueOnce({ code, message: 'known rollback', writeEvidence: 'not-written' });
      await expect(savePreparedStoryCommit(port, commit)).rejects.toMatchObject({ evidence: 'not-written' });
      expect(await savePreparedStoryCommit(port, commit, 'not-written')).toEqual(receipt(commit));
      expect(port.begin).toHaveBeenCalledTimes(2);
    }
    const commit = await prepare(); const port = portFor(commit);
    vi.mocked(port.end).mockRejectedValueOnce({ code: 'story-commit-unknown', message: 'unknown commit', writeEvidence: 'unknown' });
    await expect(savePreparedStoryCommit(port, commit)).rejects.toMatchObject({ evidence: 'unknown' });
  });
  it('known pre-end failure permits same-package local retry without changing IDs or content', async () => {
    const commit = await prepare(); const port = portFor(commit);
    vi.mocked(port.append).mockRejectedValueOnce(new Error('disk failure'));
    await expect(savePreparedStoryCommit(port, commit)).rejects.toBeInstanceOf(StorySaveError);
    expect(port.end).not.toHaveBeenCalled();
    expect(await savePreparedStoryCommit(port, commit, 'not-written')).toEqual(receipt(commit));
    expect(vi.mocked(port.begin).mock.calls[0]![0]).toBe(vi.mocked(port.begin).mock.calls[1]![0]);
  });
  it('rejects wrong receipt identity and malformed frame receipts', async () => {
    const commit = await prepare(); const port = portFor(commit);
    vi.mocked(port.receipt).mockResolvedValue({ ...receipt(commit), revision: 2 });
    await expect(queryStoryCommitReceipt(port, commit)).rejects.toThrow();
    vi.mocked(port.receipt).mockResolvedValue(null); vi.mocked(port.append).mockResolvedValue({ token, kind: 'session', receivedBytes: 0 });
    await expect(savePreparedStoryCommit(port, commit)).rejects.toMatchObject({ evidence: 'not-written' }); expect(port.end).not.toHaveBeenCalled();
  });
  it('append declarations exclude seed/checkpoint0 and check input/head relationships', async () => {
    const commit = await prepare(2); expect(commit.parts.map((part) => part.kind)).toEqual(['session', 'chapter', 'checkpoint1']);
    await expect(prepareStoryStorageCommit({ ...records(2), expectedRevision: 1, expectedLastChapterId: 'wrong', lastInputCheckpointId: 'story-checkpoint-1' })).rejects.toThrow();
    expect(StoryCommitManifestSchema.safeParse({ ...commit.manifest, parts: [...commit.manifest.parts].reverse() }).success).toBe(false);
  });
});

const reader = (total: number) => {
  const all = Array.from({ length: total }, (_, i) => ({ ...records(i + 1).chapter, titlePreview: '标题', titleTruncated: false, markdownByteLength: 16 }));
  const docs = new Map(all.map((chapter) => { const p = prepareBattleStoryCommitJson(chapter, 100_000); return [chapter.id, Buffer.concat([...p.chunks(17)])]; }));
  const head: StorySessionHead = { id: 'story', revision: total, titlePreview: '故事', titleTruncated: false, mode: 'classic', createdAt: 100, updatedAt: 99 + total, chapterCount: total, lastChapterId: `story-chapter-${total}` };
  const port = portFor({} as PreparedStoryCommit);
  vi.mocked(port.listChapters).mockImplementation(async (_session, _revision, cursor, limit) => {
    const offset = cursor?.index ?? 0; const rows = all.slice(offset, offset + limit).map(({ id, index, action, titlePreview, titleTruncated, createdAt, markdownByteLength }) => ({ id, index, action, status: 'active', titlePreview, titleTruncated, createdAt, markdownByteLength }));
    const last = rows.at(-1)!;
    return { sessionId: head.id, revision: head.revision, rows, nextCursor: offset + rows.length < total ? { id: last.id, index: last.index } : null };
  });
  vi.mocked(port.describe).mockImplementation(async (sessionId, revision, kind, recordId) => ({ instance: 'a'.repeat(32), sessionId, revision, kind, recordId, byteLength: docs.get(recordId)!.length, digest: bytesDigest(docs.get(recordId)!) }));
  vi.mocked(port.read).mockImplementation(async (descriptor, offset, length) => new Uint8Array(docs.get(descriptor.recordId)!.subarray(offset, offset + length)));
  return { port, head, all, docs };
};
describe('summary/selected/full-story reads', () => {
  it('sequential context projection is byte-identical to the existing twelve-chapter / last-two window', () => {
    const chapters = Array.from({length:12},(_,i)=>({...records(i+1).chapter,markdown:`# 章 ${i}\n`+'中'.repeat(10000)}));
    const projected=chapters.map((chapter,index)=>projectBattleStoryPromptWindowItem(chapter,index<10?'digest':'full',6000));
    expect(projected).toEqual(resolveBattleStoryRecentWindow({chapters,maxRecentChapters:2,maxFullChapterChars:6000}));
    expect(projected.slice(0,10).every((item)=>item.mode==='digest')).toBe(true);
    expect(projected.slice(-2).every((item)=>item.mode==='full'&&item.truncated)).toBe(true);
    expect(projected.every((item)=>!Object.hasOwn(item,'markdown'))).toBe(true);
  });

  it('hydrates only the selected chapter and preserves full escaped bytes', async () => {
    const { port, head, all } = reader(3);
    expect(await readSelectedStoryChapter(port, head, 'story-chapter-2')).toMatchObject(all[1]!);
    expect(port.describe).toHaveBeenCalledTimes(1); expect(port.listChapters).not.toHaveBeenCalled();
  });
  it('returns validated original JSON including own __proto__ extensions without prototype pollution', async () => {
    const { port, head, all, docs } = reader(1);
    const value = JSON.parse(JSON.stringify(all[0]));
    Object.defineProperty(value, '__proto__', { enumerable: true, writable: true, value: { retained: 'top' } });
    Object.defineProperty(value.reportJson, '__proto__', { enumerable: true, writable: true, value: { retained: 'report' } });
    const prepared = prepareBattleStoryCommitJson(value, 100_000);
    docs.set(value.id, Buffer.concat([...prepared.chunks(17)]));
    const read = await readSelectedStoryChapter(port, head, value.id);
    expect(Object.hasOwn(read, '__proto__')).toBe(true);
    expect(Object.hasOwn(read.reportJson, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(JSON.stringify(read)).toBe(Buffer.concat([...prepared.chunks(17)]).toString());
  });
  it('reads every page for full export, even when visible page is only 25 rows', async () => {
    const { port, head } = reader(63); const ids: string[] = [];
    for await (const chapter of readAllCommittedStoryChapters(port, head)) ids.push(chapter.id);
    expect(ids).toHaveLength(63); expect(ids.at(-1)).toBe('story-chapter-63'); expect(port.listChapters).toHaveBeenCalledTimes(3); expect(port.read).toHaveBeenCalledTimes(63);
  });
  it('partial/truncated page never marks a complete-story traversal successful', async () => {
    const { port, head } = reader(63);
    const original = vi.mocked(port.listChapters).getMockImplementation()!;
    vi.mocked(port.listChapters).mockImplementation(async (...args) => ({ ...(await original(...args) as Record<string, unknown>), nextCursor: null }));
    await expect((async () => { for await (const chapter of readAllCommittedStoryChapters(port, head)) { expect(chapter.id).toBeTruthy(); } })()).rejects.toThrow('未读取完整');
  });
  it('wrong record identity, raw digest, frame size and cancelled late read fail instead of publishing', async () => {
    const { port, head } = reader(2);
    const descriptor = await port.describe(head.id, head.revision, 'chapter', 'story-chapter-1') as StoryRecordDescriptor;
    vi.mocked(port.describe).mockResolvedValueOnce({ ...descriptor, recordId: 'story-chapter-2' });
    await expect(readSelectedStoryChapter(port, head, 'story-chapter-1')).rejects.toThrow('身份');
    vi.mocked(port.read).mockResolvedValueOnce(new Uint8Array(descriptor.byteLength));
    await expect(readSelectedStoryChapter(port, head, 'story-chapter-1')).rejects.toThrow();
    const controller = new AbortController(); vi.mocked(port.read).mockImplementationOnce(async () => { controller.abort(); return new Uint8Array(descriptor.byteLength); });
    await expect(readSelectedStoryChapter(port, head, 'story-chapter-1', controller.signal)).rejects.toThrow();
  });
});


const exportReader = async (total: number, depth?: number) => {
  const r = reader(total); const first = await prepare();
  const session = { ...first.parts[0]!.prepared.value as object, revision: r.head.revision, chapterCount: total, lastChapterId: r.head.lastChapterId };
  r.docs.set(r.head.id, Buffer.concat([...prepareBattleStoryCommitJson(session, 100_000).chunks()]));
  if (depth !== undefined) {
    const chapter = { ...r.all[0], cardSnapshot: { adjudicationResults: [{ description: '事件🙂', outcome: '结果', details: '扩展', depth }] } };
    r.docs.set(r.all[0]!.id, Buffer.concat([...prepareBattleStoryCommitJson(chapter, 100_000).chunks()]));
  }
  return r;
};
const exportSink = () => {
  const chunks: Uint8Array[] = []; let declared = 0;
  const sink: StoryMarkdownExportPort = {
    begin: vi.fn(async (manifest) => { declared = manifest.expectedByteLength; return { token, expectedByteLength: declared }; }),
    append: vi.fn(async (_token, offset, bytes) => { chunks.push(bytes.slice()); return { token, receivedBytes: offset + bytes.byteLength }; }),
    end: vi.fn(async (_token, digest) => { const bytes = Buffer.concat(chunks); expect(bytes.length).toBe(declared); expect(bytesDigest(bytes)).toBe(digest); return { token, absolutePath: '/native/exports/story.md', byteLength: declared }; }),
    abort: vi.fn(async () => {}),
  };
  return { sink, chunks };
};
describe('double-pass complete Markdown export', () => {
  it('counts every page before begin, writes all pages again, compares actual hash and only then publishes', async () => {
    const { port, head } = await exportReader(53, 20); const { sink, chunks } = exportSink();
    const begin = vi.mocked(sink.begin).getMockImplementation()!;
    vi.mocked(sink.begin).mockImplementation(async (manifest) => { expect(port.listChapters).toHaveBeenCalledTimes(3); expect(sink.append).not.toHaveBeenCalled(); return begin(manifest); });
    const result = await exportCommittedStoryMarkdown(port, sink, head);
    expect(result.absolutePath).toBe('/native/exports/story.md'); expect(port.listChapters).toHaveBeenCalledTimes(6);
    expect(sink.end).toHaveBeenCalledTimes(1); expect(sink.abort).toHaveBeenCalledWith(token);
    expect(Buffer.concat(chunks).toString()).toContain('随机判定记录'); expect(chunks.every((chunk) => chunk.byteLength <= 192 * 1024)).toBe(true);
  });
  it('counts PB-scale indentation in O(1) and reaches native disk rejection without hashing/writing it', async () => {
    const { port, head } = await exportReader(1, 1_000_000_000_000_000); const { sink } = exportSink();
    vi.mocked(sink.begin).mockImplementation(async (manifest) => { expect(manifest.expectedByteLength).toBeGreaterThanOrEqual(4_000_000_000_000_000); throw new Error('Native 可用磁盘不足'); });
    await expect(exportCommittedStoryMarkdown(port, sink, head)).rejects.toThrow('磁盘不足');
    expect(sink.append).not.toHaveBeenCalled(); expect(sink.end).not.toHaveBeenCalled();
  });
  it('cancels both counting and writing and never publishes a partial file', async () => {
    for (const phase of ['counting', 'writing']) {
      const { port, head } = await exportReader(2); const { sink } = exportSink(); const controller = new AbortController();
      await expect(exportCommittedStoryMarkdown(port, sink, head, { signal: controller.signal, onProgress: (progress) => { if (progress.phase === phase && progress.bytes > 0) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
      expect(sink.end).not.toHaveBeenCalled();
      if (phase === 'counting') expect(sink.begin).not.toHaveBeenCalled(); else expect(sink.abort).toHaveBeenCalledWith(token);
    }
  });
  it('rejects unsafe depth before native begin and detects second-pass missing pages', async () => {
    const unsafe = await exportReader(1, Number.MAX_SAFE_INTEGER); const first = exportSink();
    await expect(exportCommittedStoryMarkdown(unsafe.port, first.sink, unsafe.head)).rejects.toThrow('安全字节长度'); expect(first.sink.begin).not.toHaveBeenCalled();
    const { port, head } = await exportReader(53); const { sink } = exportSink();
    const listing = vi.mocked(port.listChapters).getMockImplementation()!; let calls = 0;
    vi.mocked(port.listChapters).mockImplementation(async (...args) => { const page = await listing(...args); return ++calls === 4 ? { ...page as object, nextCursor: null } : page; });
    await expect(exportCommittedStoryMarkdown(port, sink, head)).rejects.toThrow('未读取完整'); expect(sink.end).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledWith(token);
  });
});
