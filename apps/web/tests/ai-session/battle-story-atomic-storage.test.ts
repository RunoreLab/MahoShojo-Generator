import '@/tests/helpers/fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME, AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import { buildCompletedBattleStoryCommit, captureBattleStoryCommitExpected } from '@mahoshojo/domain/arena-story-commit';
import * as storage from '@/lib/ai-session/battle-story/storage';

const makeSession = () => storage.createBattleStorySessionRecord({
  title: '原子故事',
  source: { mode: 'daily', language: 'zh-CN', storyLength: 'standard', generationMode: 'stream' },
  seed: { combatants: [{ name: '测试角色' }], settings: { readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false, readNarrativeHistory: false, writeNarrativeHistory: false } },
  workingCombatants: [{ name: '测试角色' }],
});

const makeStart = () => {
  const session = makeSession();
  return buildCompletedBattleStoryCommit({
    action: 'start', session, expected: null, operationId: crypto.randomUUID(), checkpointId: crypto.randomUUID(), initialCheckpointId: crypto.randomUUID(), now: Date.now(), source: session.source, inputCombatants: session.workingCombatants,
    generated: { chapterIndex: 1, markdown: '# 首章\n正文', reportJson: {}, digest: { chapterTitle: '首章' }, nextWorkingCombatants: [{ name: '测试角色', extension: { history: ['保留'] } }] },
  });
};
const makeContinue = (first: ReturnType<typeof makeStart>, operationId = crypto.randomUUID()) => buildCompletedBattleStoryCommit({
  action: 'continue', session: first.session,
  expected: captureBattleStoryCommitExpected({ session: first.session, chapters: [first.chapter], checkpoint: first.checkpoints[1]! }),
  operationId, checkpointId: crypto.randomUUID(), now: Date.now(), source: first.session.source, inputCombatants: first.session.workingCombatants,
  generated: { chapterIndex: 2, markdown: '# 第二章\n正文', reportJson: {}, digest: { chapterTitle: '第二章' }, nextWorkingCombatants: [{ name: '测试角色', extension: { history: ['保留', '新增'] } }] },
});

beforeEach(async () => {
  await __resetAiSessionDbForTest();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
});
afterEach(async () => { vi.restoreAllMocks(); await __resetAiSessionDbForTest(); });

describe('真实 IndexedDB 事务失败边界', () => {
  it('首章同事务：任一 checkpoint 写入后 abort 不留下 session/chapter', async () => {
    const commit = makeStart();
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = add.apply(this, args);
      if (this.name === AI_SESSION_STORE_NAMES.battleStoryCheckpoints) request.addEventListener('success', () => { try { this.transaction.abort(); } catch { /* already aborted */ } });
      return request;
    });
    await expect(storage.commitCompletedBattleStoryChapter(commit)).rejects.toBeTruthy();
    expect(await storage.getBattleStorySession(commit.session.id)).toBeNull();
    expect(await storage.getBattleStoryChapter(commit.chapter.id)).toBeNull();
    expect(await storage.getBattleStoryOperationReceipt(commit.operationId)).toBeNull();
  });

  it('session 的 put request 成功后事务 abort，不得先返回成功', async () => {
    const session = makeSession();
    await storage.putBattleStorySession(session);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = put.apply(this, args);
      if (this.name === AI_SESSION_STORE_NAMES.battleStorySessions) request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(storage.updateBattleStorySession(session.id, (current) => ({ ...current, title: '未落盘标题' }))).rejects.toBeTruthy();
    expect((await storage.getBattleStorySession(session.id))?.title).toBe('原子故事');
  });
});


describe('原子完成章 CAS 与持久回执', () => {
  it('成功时三 store 同时可读，重开仍可读精确回执，后续 append 后旧 operation 仍可重放', async () => {
    const first = makeStart();
    const receipt = await storage.commitCompletedBattleStoryChapter(first);
    expect(await storage.getBattleStorySession(first.session.id)).toEqual(first.session);
    expect((await storage.getBattleStoryChapter(first.chapter.id))?.markdown).toBe(first.chapter.markdown);
    expect(await storage.listBattleStoryCheckpointsBySession(first.session.id)).toEqual(first.checkpoints);
    await __resetAiSessionDbForTest();
    expect(await storage.getBattleStoryOperationReceipt(first.operationId)).toEqual(receipt);
    const next = makeContinue(first);
    await storage.commitCompletedBattleStoryChapter(next);
    expect(await storage.commitCompletedBattleStoryChapter(first)).toEqual(receipt);
    expect((await storage.getBattleStorySession(first.session.id))?.chapterCount).toBe(2);
    expect(JSON.stringify(receipt)).not.toContain('正文');
  });
  it('同 operation 不同正文/未知扩展拒绝，两个 continue 同 head 只有一个成功', async () => {
    const first = makeStart(); await storage.commitCompletedBattleStoryChapter(first);
    await expect(storage.commitCompletedBattleStoryChapter({ ...first, chapter: { ...first.chapter, markdown: '改过正文' } })).rejects.toThrow('不一致');
    const one = makeContinue(first); const two = makeContinue(first);
    const results = await Promise.allSettled([storage.commitCompletedBattleStoryChapter(one), storage.commitCompletedBattleStoryChapter(two)]);
    expect(results.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await storage.listBattleStoryChaptersBySession(first.session.id)).toHaveLength(2);
    expect(await storage.listBattleStoryCheckpointsBySession(first.session.id)).toHaveLength(3);
  });
  it.each(['summary', 'checkpoint', 'superseded', 'delete'] as const)('旧 %s writer 修改后拒绝 stale continue 且保留旧状态', async (kind) => {
    const first = makeStart(); await storage.commitCompletedBattleStoryChapter(first);
    const next = makeContinue(first);
    if (kind === 'summary') await storage.updateBattleStorySession(first.session.id, (current) => ({ ...current, sessionSummary: '新摘要', summaryMeta: { mode: 'ai', refreshedAt: Date.now(), coveredUntilChapterIndex: 1, coveredChapterIds: [first.chapter.id] } }));
    if (kind === 'checkpoint') await storage.putBattleStoryCheckpoint({ ...first.checkpoints[1]!, combatants: [{ changed: true }] });
    if (kind === 'superseded') await storage.markBattleStoryChapterSuperseded({ chapterId: first.chapter.id, supersededByChapterId: 'rewrite' });
    if (kind === 'delete') await storage.deleteBattleStoryCheckpointsFromBoundary({ sessionId: first.session.id, startBoundaryIndex: 1 });
    await expect(storage.commitCompletedBattleStoryChapter(next)).rejects.toBeTruthy();
    expect(await storage.getBattleStoryChapter(next.chapter.id)).toBeNull();
    expect(await storage.getBattleStoryCheckpointByBoundary(first.session.id, 2)).toBeNull();
  });
  it('迟到 summary expected 失败，不能覆盖新 head 或更新旧摘要', async () => {
    const first = makeStart(); await storage.commitCompletedBattleStoryChapter(first);
    const next = makeContinue(first); await storage.commitCompletedBattleStoryChapter(next);
    await expect(storage.updateBattleStorySession(first.session.id, (current) => ({ ...current, sessionSummary: '过时' }), first.session)).rejects.toThrow('过时');
    expect(await storage.getBattleStorySession(first.session.id)).toEqual(next.session);
  });
  it('旧记录缺 receipt/checkpoint 仍可继续，未知 JSON 扩展完整保留', async () => {
    const first = makeStart();
    const legacy = { ...first.session, unknownExtension: { foo: ['bar', 3], nested: { stay: true } } };
    await storage.putBattleStorySession(legacy); await storage.putBattleStoryChapter(first.chapter);
    const next = { ...makeContinue(first), expected: captureBattleStoryCommitExpected({ session: legacy, chapters: [first.chapter], checkpoint: null }), session: { ...makeContinue(first).session, ...legacy } };
    // Build with the real legacy input so head and extensions are carried forward.
    const commit = buildCompletedBattleStoryCommit({ action: 'continue', session: legacy, expected: next.expected, operationId: crypto.randomUUID(), checkpointId: crypto.randomUUID(), now: Date.now(), source: legacy.source, inputCombatants: legacy.workingCombatants, generated: { chapterIndex: 2, markdown: '正文', reportJson: {}, digest: { chapterTitle: '续写' }, nextWorkingCombatants: legacy.workingCombatants } });
    await storage.commitCompletedBattleStoryChapter(commit);
    expect(await storage.getBattleStorySession(legacy.id)).toEqual(commit.session);
  });
  it.each([1, 2, 3, 4])('第 %i 次 record 写入成功后 abort 全回滚', async (writeIndex) => {
    const first = makeStart(); let writes = 0;
    for (const method of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[method];
      vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function(this: IDBObjectStore, ...args) {
        const request = original.apply(this, args);
        if (++writes === writeIndex) request.addEventListener('success', () => this.transaction.abort());
        return request;
      });
    }
    await expect(storage.commitCompletedBattleStoryChapter(first)).rejects.toBeTruthy();
    expect(await storage.getBattleStorySession(first.session.id)).toBeNull();
    expect(await storage.getBattleStoryChapter(first.chapter.id)).toBeNull();
    expect(await storage.listBattleStoryCheckpointsBySession(first.session.id)).toEqual([]);
  });
  it('写入开始后的同步 DataCloneError 也 abort 之前请求', async () => {
    const first = makeStart();
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args) {
      if (this.name === AI_SESSION_STORE_NAMES.battleStoryCheckpoints) throw new DOMException('clone fault', 'DataCloneError');
      return add.apply(this, args);
    });
    await expect(storage.commitCompletedBattleStoryChapter(first)).rejects.toThrow('clone fault');
    expect(await storage.getBattleStorySession(first.session.id)).toBeNull();
    expect(await storage.getBattleStoryChapter(first.chapter.id)).toBeNull();
  });
});
