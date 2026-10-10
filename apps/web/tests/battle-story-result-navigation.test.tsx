// @vitest-environment jsdom

import React, { act, StrictMode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBattleStorySession } from '@/components/arena/hooks/useBattleStorySession';
import * as storage from '@/lib/ai-session/battle-story/storage';
import type { BattleStoryCheckpointRecord, BattleStoryChapterRecord, BattleStorySessionRecord } from '@/lib/ai-session/battle-story/types';

const fixture = vi.hoisted(() => ({
  sessions: new Map<string, BattleStorySessionRecord>(),
  chapters: new Map<string, BattleStoryChapterRecord>(),
  checkpoints: new Map<string, BattleStoryCheckpointRecord>(),
  dispatch: vi.fn(),
  startCooldown: vi.fn(),
  state: {
    combatants: [{ type: 'magical-girl', data: { codename: '测试角色' }, isValid: true }],
    battleMode: 'daily', scenario: { content: null, fileName: '' }, userProviderConfig: null,
    auxScenarios: [], materials: [], selectedQuestionnaires: [], adjudicationEvents: [],
    selectedLanguage: 'zh-CN', storyLength: 'standard',
    settings: { userGuidance: '', writeArenaHistory: false, writeCurrentState: false },
  },
}));

vi.mock('@/components/arena/stores/useBattleStore', () => ({
  useBattleStore: Object.assign((selector: (state: typeof fixture.state) => unknown) => selector(fixture.state), {
    getState: () => fixture.state,
  }),
}));
vi.mock('@/components/arena/hooks/useBattleActions', () => ({
  useBattleActions: () => ({ handleResolveRandomPlaceholders: async () => {} }),
}));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({
  useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: fixture.dispatch }) }),
}));
vi.mock('@/lib/auth', () => ({ authStorage: {
  getAuthHeader: async () => null, getActivityHeaders: async () => ({}),
} }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({
  isCooldown: false, remainingTime: 0, otherRemainingTime: 0, startCooldown: fixture.startCooldown,
}) }));
vi.mock('@/lib/ai-session/battle-story/storage', async (importOriginal) => {
  const original = await importOriginal<typeof storage>();
  return {
    ...original,
    commitCompletedBattleStoryChapter: vi.fn(async (commit: storage.WebBattleStoryCompletedCommit) => {
      fixture.sessions.set(commit.session.id, commit.session);
      fixture.chapters.set(commit.chapter.id, commit.chapter);
      for (const item of commit.checkpoints) fixture.checkpoints.set(item.id, item);
      return { version: 1, operationId: commit.operationId, sessionId: commit.session.id, chapterId: commit.chapter.id, chapterIndex: commit.chapter.index, chapterCount: commit.session.chapterCount, checkpointIds: commit.checkpoints.map((item) => item.id), contentDigest: 'navigation-fixture' };
    }),
    listBattleStorySessions: vi.fn(async () => [...fixture.sessions.values()]),
    getBattleStorySession: vi.fn(async (id: string) => fixture.sessions.get(id) ?? null),
    listBattleStoryChaptersBySession: vi.fn(async (id: string) => [...fixture.chapters.values()].filter((item) => item.sessionId === id)),
    listBattleStoryCheckpointsBySession: vi.fn(async (id: string) => [...fixture.checkpoints.values()].filter((item) => item.sessionId === id)),
    deleteBattleStorySession: vi.fn(async (id: string) => { fixture.sessions.delete(id); }),
    updateBattleStorySession: vi.fn(async (id: string, update: (record: BattleStorySessionRecord) => BattleStorySessionRecord) => {
      const next = update(fixture.sessions.get(id)!); fixture.sessions.set(id, next); return next;
    }),
    deleteBattleStoryChaptersFromIndex: vi.fn(async ({ sessionId, startIndex }: { sessionId: string; startIndex: number }) => {
      for (const [id, item] of fixture.chapters) if (item.sessionId === sessionId && item.index >= startIndex) fixture.chapters.delete(id);
    }),
    deleteBattleStoryCheckpointsFromBoundary: vi.fn(async ({ sessionId, startBoundaryIndex }: { sessionId: string; startBoundaryIndex: number }) => {
      for (const [id, item] of fixture.checkpoints) if (item.sessionId === sessionId && item.boundaryIndex >= startBoundaryIndex) fixture.checkpoints.delete(id);
    }),
    putBattleStorySession: async (item: BattleStorySessionRecord) => { fixture.sessions.set(item.id, item); },
    putBattleStoryChapter: async (item: BattleStoryChapterRecord) => { fixture.chapters.set(item.id, item); },
    putBattleStoryCheckpoints: async (items: BattleStoryCheckpointRecord[]) => {
      for (const item of items) fixture.checkpoints.set(item.id, item);
    },
  };
});

let session: ReturnType<typeof useBattleStorySession>;
let container: HTMLDivElement;
let root: Root;
let stream: ReadableStreamDefaultController<Uint8Array>;
let requestSignal: AbortSignal;
const scroll = vi.fn();
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const send = (events: string) => stream.enqueue(new TextEncoder().encode(events));

// Match the Panel's live/selected content branch so a stale notification would
// visibly target the old chapter (or the empty first-chapter result container).
function Harness() {
  const value = useBattleStorySession();
  useLayoutEffect(() => { session = value; });
  return <div ref={value.resultSectionRef} data-testid="result">
    {value.isGenerating
      ? <article data-testid="live">{value.streamingMarkdown || '等待正文'}</article>
      : <article data-testid="saved">{value.selectedChapter?.markdown ?? ''}</article>}
  </div>;
}

async function mount() {
  await act(async () => root.render(<Harness />));
  expect(session.isReady).toBe(true);
}

async function start() {
  let pending!: Promise<void>;
  await act(async () => { pending = session.handleStartSession(); });
  expect(fixture.dispatch).toHaveBeenCalled();
  expect(session.isGenerating).toBe(true);
  return { pending };
}

function addHistory(title = '历史会话') {
  const record = storage.createBattleStorySessionRecord({
    title, source: { mode: 'daily', language: 'zh-CN', storyLength: 'standard', generationMode: 'stream' },
    seed: { combatants: [], settings: { readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false, readNarrativeHistory: false, writeNarrativeHistory: false } },
    workingCombatants: [],
  });
  for (const index of [1, 2]) {
    const chapter = storage.createBattleStoryChapterRecord({
      sessionId: record.id, index, action: index === 1 ? 'start' : 'continue', title: `旧章${index}`,
      markdown: `历史正文${index}`, reportJson: {}, deterministicDigest: { chapterTitle: `旧章${index}`, bodyExcerpt: `历史正文${index}` },
    });
    fixture.chapters.set(chapter.id, chapter);
    record.lastChapterId = chapter.id;
  }
  record.chapterCount = 2;
  fixture.sessions.set(record.id, record);
  return record;
}

beforeEach(() => {
  fixture.sessions.clear(); fixture.chapters.clear(); fixture.checkpoints.clear(); fixture.dispatch.mockReset();
  vi.mocked(storage.listBattleStorySessions).mockReset().mockImplementation(async () => [...fixture.sessions.values()]);
  vi.mocked(storage.getBattleStorySession).mockReset().mockImplementation(async (id) => fixture.sessions.get(id) ?? null);
  vi.mocked(storage.listBattleStoryChaptersBySession).mockReset().mockImplementation(async (id) => [...fixture.chapters.values()].filter((item) => item.sessionId === id));
  vi.mocked(storage.listBattleStoryCheckpointsBySession).mockReset().mockImplementation(async (id) => [...fixture.checkpoints.values()].filter((item) => item.sessionId === id));
  localStorage.clear(); scroll.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2000 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  fixture.dispatch.mockImplementation(async (_url: string, init: RequestInit) => {
    requestSignal = init.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      requestSignal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe('Battle story generated-result navigation through the real session hook and SSE reader', () => {
  it('首章占位及仅 reasoning 不滚，首正文一次，增量和 done 不重复', async () => {
    await mount();
    const { pending } = await start();
    expect(container.textContent).toBe('等待正文');
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => send(event('reasoning', { chunk: '思考过程' })));
    expect(session.streamCardSnapshot?.aiReasoning).toBeTruthy();
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => send(event('markdown', { chunk: '# 首章\n\n正文' })));
    expect(container.textContent).toContain('首章');
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth', block: 'start' });
    await act(async () => {
      send(event('markdown', { chunk: '后续正文' }) + event('done', { ok: true }));
      stream.close(); await pending;
    });
    expect(session.chapters).toHaveLength(1);
    expect(session.selectedChapter?.markdown).toContain('后续正文');
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('同 batch 正文和成功 done 定位已提交章节，下一次生成仍可独立定位', async () => {
    await mount();
    for (const index of [1, 2]) {
      const { pending } = await start();
      await act(async () => {
        send(event('markdown', { chunk: `# 新章${index}` }) + event('done', { ok: true }));
        stream.close(); await pending;
      });
      expect(container.textContent).toBe(`# 新章${index}`);
      expect(session.isGenerating).toBe(false);
      expect(scroll).toHaveBeenCalledTimes(index);
    }
  });

  it('恢复本地会话和选择旧章节不触发生成定位', async () => {
    const record = addHistory();
    localStorage.setItem('arena.battleStory.activeSessionId', record.id);
    await mount();
    expect(container.textContent).toBe('历史正文2');
    const first = [...fixture.chapters.values()][0]!;
    await act(async () => session.setSelectedChapterId(first.id));
    expect(container.textContent).toBe('历史正文1');
    await act(async () => session.handleSelectSession(record.id));
    expect(scroll).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it('正文与用户取消同 batch 时撤销排队定位，且不写入章节', async () => {
    await mount();
    const { pending } = await start();
    await act(async () => {
      send(event('markdown', { chunk: '尚未显示的正文' }));
      await Promise.resolve();
      session.stopGeneration();
      await pending;
    });
    expect(requestSignal.aborted).toBe(true);
    expect(session.isGenerating).toBe(false);
    expect(fixture.chapters.size).toBe(0);
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each([false, true])('同 batch 正文和 done 失败不定位到消失的预览或旧章（有历史=%s）', async (withHistory) => {
    if (withHistory) addHistory();
    await mount();
    const { pending } = await start();
    await act(async () => {
      send(event('markdown', { chunk: '失败章节正文' }) + event('done', { ok: false, error: '完成阶段失败' }));
      stream.close(); await pending;
    });
    expect(session.actionError).toBe('完成阶段失败');
    expect(session.isGenerating).toBe(false);
    expect(requestSignal.aborted).toBe(false);
    expect(container.textContent).toBe(withHistory ? '历史正文2' : '');
    expect(fixture.chapters.size).toBe(withHistory ? 2 : 0);
    expect(scroll).not.toHaveBeenCalled();
  });
});


const ACTIVE_KEY = 'arena.battleStory.activeSessionId';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function select(id: string) {
  let pending!: Promise<void>;
  await act(async () => { pending = session.handleSelectSession(id); });
  return { pending };
}
function expectActive(record: BattleStorySessionRecord) {
  expect(session.activeSession).toEqual(record);
  expect(session.chapters.map((item) => item.sessionId)).toEqual([record.id, record.id]);
  expect(session.selectedChapterId).toBe(record.lastChapterId);
  expect(localStorage.getItem(ACTIVE_KEY)).toBe(record.id);
}

describe('Battle story storage reads through the real React session hook', () => {
  it.each(['success', 'missing', 'error'] as const)('B 后发先完成后，A 迟到 %s 不覆盖选择/章节/偏好/错误', async (outcome) => {
    const a = addHistory('A'); const b = addHistory('B');
    await mount();
    const late = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => late.promise);
    const first = await select(a.id);
    const second = await select(b.id); await second.pending;
    expectActive(b);
    await act(async () => {
      if (outcome === 'error') late.reject(new Error('过期读取失败'));
      else late.resolve(outcome === 'missing' ? null : a);
      await first.pending;
    });
    expectActive(b);
    expect(session.actionError).toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'] as const)('初始化列表迟到 %s 不创建压过手动 B 的新选择意图', async (outcome) => {
    const a = addHistory('A'); const b = addHistory('B');
    localStorage.setItem(ACTIVE_KEY, a.id);
    const late = deferred<BattleStorySessionRecord[]>();
    vi.mocked(storage.listBattleStorySessions).mockImplementationOnce(() => late.promise);
    await act(async () => root.render(<Harness />));
    const chosen = await select(b.id); await chosen.pending;
    await act(async () => {
      if (outcome === 'error') late.reject(new Error('过期列表错误'));
      else late.resolve([a, b]);
    });
    expectActive(b); expect(session.storageError).toBeNull(); expect(session.isReady).toBe(true);
    expect(storage.getBattleStorySession).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'missing', 'error'] as const)('初始化详情迟到 %s 不覆盖手动 B', async (outcome) => {
    const a = addHistory('A'); const b = addHistory('B');
    const late = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => late.promise);
    await act(async () => root.render(<Harness />));
    const chosen = await select(b.id); await chosen.pending;
    await act(async () => {
      if (outcome === 'error') late.reject(new Error('旧初始化错误'));
      else late.resolve(outcome === 'missing' ? null : a);
    });
    expectActive(b); expect(session.storageError).toBeNull(); expect(session.isReady).toBe(true);
  });

  it('读取部分失败保留旧显示及偏好，当前 missing 才清空，空选择也使旧读取失效', async () => {
    const a = addHistory('A'); const b = addHistory('B'); await mount();
    const lateChapters = deferred<BattleStoryChapterRecord[]>();
    vi.mocked(storage.listBattleStoryChaptersBySession).mockImplementationOnce(() => lateChapters.promise);
    const failed = await select(b.id);
    expectActive(a); // session alone cannot publish a partial snapshot
    await act(async () => { lateChapters.reject(new Error('章节读取失败')); await failed.pending; });
    expectActive(a); expect(session.actionError).toBe('章节读取失败');
    await act(async () => session.handleSelectSession('missing'));
    expect(session.activeSession).toBeNull(); expect(session.chapters).toEqual([]);
    expect(session.selectedChapterId).toBeNull(); expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    const late = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => late.promise);
    const reading = await select(b.id);
    await act(async () => session.handleSelectSession(''));
    await act(async () => { late.resolve(b); await reading.pending; });
    expect(session.activeSession).toBeNull(); expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it('saved key 指向 missing 不 fallback；无 key 沿用列表首项，查询上限保持', async () => {
    const a = addHistory('A'); localStorage.setItem(ACTIVE_KEY, 'missing'); await mount();
    expect(session.activeSession).toBeNull(); expect(storage.getBattleStorySession).toHaveBeenCalledExactlyOnceWith('missing');
    expect(storage.listBattleStorySessions).toHaveBeenCalledExactlyOnceWith({ limit: 100, direction: 'prev' });
    expect(storage.listBattleStoryChaptersBySession).toHaveBeenCalledExactlyOnceWith('missing', { direction: 'next', limit: 200, includeSuperseded: false });
    expect(storage.listBattleStoryCheckpointsBySession).toHaveBeenCalledExactlyOnceWith('missing', { direction: 'next', limit: 400 });
    await act(async () => root.unmount()); root = createRoot(container); await mount(); expectActive(a);
  });

  it('unmount 后旧详情不写偏好，重新 mount 的 B 保持有效', async () => {
    const a = addHistory('A'); const b = addHistory('B');
    const late = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => late.promise);
    await act(async () => root.render(<Harness />));
    await act(async () => root.unmount());
    localStorage.setItem(ACTIVE_KEY, b.id); root = createRoot(container); await mount();
    await act(async () => late.resolve(a)); expectActive(b);
  });

  it('StrictMode effect 重挂载不允许第一次恢复列表或详情复活', async () => {
    const a = addHistory('A'); const b = addHistory('B');
    const lateList = deferred<BattleStorySessionRecord[]>();
    vi.mocked(storage.listBattleStorySessions).mockImplementationOnce(() => lateList.promise);
    localStorage.setItem(ACTIVE_KEY, b.id);
    await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    expectActive(b);
    await act(async () => lateList.resolve([a])); expectActive(b);
    expect(session.sessions).toEqual([a, b]);
  });

  it('初始化旧列表被刷新 supersede，不覆盖最新列表或手动详情', async () => {
    const a = addHistory('A'); const b = addHistory('B'); const removed = addHistory('待删');
    const list = deferred<BattleStorySessionRecord[]>();
    vi.mocked(storage.listBattleStorySessions).mockImplementationOnce(() => list.promise);
    await act(async () => root.render(<Harness />));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => session.handleDeleteSession(removed.id));
    const detail = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => detail.promise);
    const choosing = await select(b.id);
    await act(async () => list.resolve([a, b, removed]));
    expect(session.sessions).toEqual([a, b]); expect(session.activeSession).toBeNull();
    await act(async () => { detail.resolve(b); await choosing.pending; }); expectActive(b);
    expect(session.storageError).toBeNull();
  });

  it('刷新列表不使正在读取的手动详情失效，刷新错误保原列表/显示', async () => {
    const a = addHistory('A'); const b = addHistory('B'); const removed = addHistory('待删'); await mount();
    const detail = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => detail.promise);
    const choosing = await select(b.id);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => session.handleDeleteSession(removed.id));
    expect(session.sessions).toEqual([a, b]); expectActive(a);
    await act(async () => { detail.resolve(b); await choosing.pending; }); expectActive(b);
    vi.mocked(storage.listBattleStorySessions).mockRejectedValueOnce(new Error('列表读取失败'));
    await act(async () => session.handleDeleteSession(a.id));
    expect(session.sessions).toEqual([a, b]); expectActive(b); expect(session.actionError).toBe('列表读取失败');
  });

  it('checkpoint 与章节全体就绪才提交；完整记录扩展保留且旧 checkpoint 不能混入 B', async () => {
    const a = addHistory('A'); const b = addHistory('B');
    Object.assign(b, { futureSessionField: { nested: ['原件'] } });
    const bChapters = [...fixture.chapters.values()].filter((item) => item.sessionId === b.id);
    Object.assign(bChapters[0]!, { futureChapterField: { nested: [42] } });
    const checkpoint = storage.createBattleStoryCheckpointRecord({ sessionId: b.id, boundaryIndex: 1, combatants: [{ preserved: true }] });
    Object.assign(checkpoint, { futureCheckpointField: { nested: true } });
    fixture.checkpoints.set(checkpoint.id, checkpoint);
    await mount();
    const oldCheckpoints = deferred<BattleStoryCheckpointRecord[]>();
    vi.mocked(storage.listBattleStoryCheckpointsBySession).mockImplementationOnce(() => oldCheckpoints.promise);
    const old = await select(a.id);
    const nextCheckpoints = deferred<BattleStoryCheckpointRecord[]>();
    vi.mocked(storage.listBattleStoryCheckpointsBySession).mockImplementationOnce(() => nextCheckpoints.promise);
    const next = await select(b.id); expectActive(a);
    await act(async () => { nextCheckpoints.resolve([checkpoint]); await next.pending; }); expectActive(b);
    expect(session.chapters).toEqual(bChapters);
    await act(async () => session.setSelectedChapterId(bChapters[0]!.id));
    expect(session.selectedBranchDisabledReason).toBeNull();
    await act(async () => { oldCheckpoints.resolve([]); await old.pending; });
    expect(session.activeSession).toEqual(b); expect(session.selectedChapter).toEqual(bChapters[0]);
    expect(session.selectedBranchDisabledReason).toBeNull();
  });

  it.each(['success', 'missing', 'error'] as const)('StrictMode 挂载详情在卸载后迟到 %s 不影响重挂载', async (outcome) => {
    const a = addHistory('A'); const b = addHistory('B');
    const detail = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => detail.promise);
    await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    expect(storage.getBattleStorySession).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount()); root = createRoot(container); localStorage.setItem(ACTIVE_KEY, b.id);
    await act(async () => root.render(<StrictMode><Harness /></StrictMode>)); expectActive(b);
    await act(async () => {
      if (outcome === 'error') detail.reject(new Error('卸载前详情失败'));
      else detail.resolve(outcome === 'missing' ? null : a);
    });
    expectActive(b); expect(session.actionError).toBeNull(); expect(session.storageError).toBeNull();
  });

  it('生成后按原顺序刷新与主动重读，不增加模型请求或结果定位次数', async () => {
    const old = addHistory(); await mount(); const { pending } = await start();
    const detail = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => detail.promise);
    await act(async () => { send(event('markdown', { chunk: '# 新会话' }) + event('done', { ok: true })); stream.close(); });
    const saved = [...fixture.sessions.values()].find((item) => item.id !== old.id)!;
    expect(saved).toBeTruthy();
    expect(storage.listBattleStorySessions).toHaveBeenCalledTimes(2);
    expect(storage.getBattleStorySession).toHaveBeenLastCalledWith(saved.id);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(old.id);
    await act(async () => { detail.resolve(saved); await pending; });
    expect(session.activeSession).toEqual(saved); expect(session.selectedChapter?.markdown).toBe('# 新会话');
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(saved.id);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1); expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('删除所选末章仍主动重读回退状态，删除首章仍整会话 fallback', async () => {
    const a = addHistory('A'); const b = addHistory('B');
    a.seed.combatants = [{ data: { codename: '初始状态' } }];
    a.lastChapterInputCombatants = [{ data: { codename: '第二章之前' } }];
    await mount(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    const first = [...fixture.chapters.values()].find((item) => item.sessionId === a.id && item.index === 1)!;
    await act(async () => session.handleDeleteSelectedChapter());
    expect(storage.deleteBattleStoryChaptersFromIndex).toHaveBeenCalledWith({ sessionId: a.id, startIndex: 2 });
    expect(storage.deleteBattleStoryCheckpointsFromBoundary).toHaveBeenCalledWith({ sessionId: a.id, startBoundaryIndex: 2 });
    expect(storage.getBattleStorySession).toHaveBeenLastCalledWith(a.id);
    expect(session.chapters).toEqual([first]); expect(session.selectedChapterId).toBe(first.id);
    expect(session.activeSession?.workingCombatants).toEqual(a.lastChapterInputCombatants);
    await act(async () => session.handleDeleteSelectedChapter()); expectActive(b);
    expect(fixture.dispatch).not.toHaveBeenCalled(); expect(scroll).not.toHaveBeenCalled();
  });

  it('活动删除后的列表即便被无关刷新 supersede，仍按原成功结果 fallback', async () => {
    const a = addHistory('A'); const b = addHistory('B'); const c = addHistory('C'); await mount();
    await act(async () => session.handleSelectSession(b.id));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const olderList = deferred<BattleStorySessionRecord[]>();
    vi.mocked(storage.listBattleStorySessions).mockImplementationOnce(() => olderList.promise);
    let deleting!: Promise<void>;
    await act(async () => { deleting = session.handleDeleteSession(b.id); });
    await act(async () => session.handleDeleteSession(c.id));
    expect(session.sessions).toEqual([a]);
    await act(async () => { olderList.resolve([a]); await deleting; }); expectActive(a);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it('活动删除的 fallback 不抢占后来仍在读取的手动选择', async () => {
    const a = addHistory('A'); const b = addHistory('B'); const c = addHistory('C'); await mount();
    await act(async () => session.handleSelectSession(b.id));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const list = deferred<BattleStorySessionRecord[]>();
    vi.mocked(storage.listBattleStorySessions).mockImplementationOnce(() => list.promise);
    let deleting!: Promise<void>;
    await act(async () => { deleting = session.handleDeleteSession(b.id); });
    const detail = deferred<BattleStorySessionRecord | null>();
    vi.mocked(storage.getBattleStorySession).mockImplementationOnce(() => detail.promise);
    const selecting = await select(c.id);
    await act(async () => { list.resolve([a, c]); await deleting; });
    expect(session.activeSession?.id).toBe(b.id); // do not briefly select A while the newer C intent is pending
    await act(async () => { detail.resolve(c); await selecting.pending; }); expectActive(c);
  });

  it('删除活动会话仍刷新列表并 fallback，再删最后会话清空', async () => {
    const a = addHistory('A'); const b = addHistory('B'); await mount();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => session.handleDeleteSession(a.id)); expectActive(b);
    await act(async () => session.handleDeleteSession(b.id));
    expect(session.sessions).toEqual([]); expect(session.activeSession).toBeNull();
    expect(session.chapters).toEqual([]); expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
});
