// @vitest-environment jsdom

import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBattleStorySession } from '@/components/arena/hooks/useBattleStorySession';
import * as storyHook from '@/components/arena/hooks/useBattleStorySession';
import { BattleStorySessionPanel } from '@/components/arena/components/BattleStorySessionPanel';
import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME, AI_SESSION_STORE_NAMES } from '@/lib/ai-session/types';
import * as storage from '@/lib/ai-session/battle-story/storage';

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  startCooldown: vi.fn(),
  download: vi.fn(),
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
vi.mock('@/components/stream/StreamingBattleReportCard', () => ({ default: (props: { content: string }) => <article>{props.content}</article> }));
vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: fixture.download }));
vi.mock('@/lib/cooldown', () => ({ getProviderCooldownNoticeText: () => null, useProviderModeCooldown: () => ({
  isCooldown: false, remainingTime: 0, otherRemainingTime: 0, startCooldown: fixture.startCooldown,
}) }));

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
      : <article data-testid="saved">{value.pendingCompletedChapter?.markdown ?? value.selectedChapter?.markdown ?? ''}</article>}
  </div>;
}

async function mount() {
  await act(async () => root.render(<Harness />));
  await vi.waitFor(async () => { await act(async () => {}); expect(session.isReady).toBe(true); });
}

async function start() {
  let pending!: Promise<void>;
  await act(async () => { pending = session.handleStartSession(); });
  expect(fixture.dispatch).toHaveBeenCalled();
  expect(session.isGenerating).toBe(true);
  return { pending };
}

beforeEach(async () => {
  await __resetAiSessionDbForTest();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  fixture.dispatch.mockReset(); fixture.download.mockReset();
  fixture.state.combatants = [{ type: 'magical-girl', data: { codename: '测试角色' }, isValid: true }];
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
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await __resetAiSessionDbForTest();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});


async function finish(pending: Promise<void>, markdown = '# 完成章\n正文') {
  await act(async () => { send(event('markdown', { chunk: markdown }) + event('done', { ok: true })); stream.close(); await pending; });
}

describe('real story hook + IndexedDB completed result persistence', () => {
  it('首章事务 abort 后保留全部生成结果，原包本地重试，模型仅调用一次', async () => {
    await mount();
    const original = IDBObjectStore.prototype.add;
    const fault = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = original.apply(this, args);
      if (this.name === AI_SESSION_STORE_NAMES.battleStoryCheckpoints) request.addEventListener('success', () => { try { this.transaction.abort(); } catch { /* already aborted */ } });
      return request;
    });
    const { pending } = await start(); await finish(pending, '# 完整原文\n角色后果与正文');
    expect(session.pendingCompletedChapter?.markdown).toBe('# 完整原文\n角色后果与正文');
    await act(async () => session.handleExportPendingChapter());
    const blob = fixture.download.mock.calls[0]![0] as Blob;
    const exported = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(exported).toBe('# 完整原文\n角色后果与正文');
    const chapterId = session.pendingCompletedChapter!.id;
    expect(await storage.listBattleStorySessions()).toHaveLength(0);
    expect(await storage.getBattleStoryChapter(chapterId)).toBeNull();
    await act(async () => { await session.handleStartSession(); await session.handleContinueSession(); });
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    fault.mockRestore();
    await act(async () => session.handleRetrySaveChapter());
    expect(session.pendingCompletedChapter).toBeNull();
    expect(session.selectedChapter?.id).toBe(chapterId);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(await storage.listBattleStoryCheckpointsBySession(session.activeSession!.id)).toHaveLength(2);
  });
  it('事务已提交但调用者丢回执：先查固定 operation，不二次保存或重模型', async () => {
    await mount();
    const original = storage.commitCompletedBattleStoryChapter;
    const save = vi.spyOn(storage, 'commitCompletedBattleStoryChapter').mockImplementationOnce(async (commit) => {
      await original(commit); throw new Error('synthetic lost reply');
    });
    const { pending } = await start(); await finish(pending);
    expect(session.pendingCompletedChapter).not.toBeNull();
    const id = session.pendingCompletedChapter!.id;
    expect(await storage.getBattleStoryOperationReceipt(id)).not.toBeNull();
    await act(async () => session.handleRetrySaveChapter());
    expect(save).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(session.pendingCompletedChapter).toBeNull();
    expect(session.selectedChapter?.id).toBe(id);
  });
  it('continue 与旧 summary 跨 tab 冲突保持旧 head，失败正文能导出或显式丢弃', async () => {
    await mount(); const first = await start(); await finish(first.pending, '# 第一章\n旧正文');
    const originalSession = session.activeSession!;
    let pending!: Promise<void>;
    await act(async () => { pending = session.handleContinueSession(); });
    await storage.updateBattleStorySession(originalSession.id, (current) => ({ ...current, sessionSummary: '另一标签更新的摘要' }));
    await finish(pending, '# 第二章\n保留失败正文');
    expect(session.pendingCompletedChapter?.markdown).toContain('保留失败正文');
    expect((await storage.getBattleStorySession(originalSession.id))?.lastChapterId).toBe(originalSession.lastChapterId);
    expect(await storage.listBattleStoryChaptersBySession(originalSession.id)).toHaveLength(1);
    await act(async () => session.handleRetrySaveChapter());
    expect(fixture.dispatch).toHaveBeenCalledTimes(2);
    expect(session.pendingCompletedChapter).not.toBeNull();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => session.handleDiscardPendingChapter());
    expect(session.pendingCompletedChapter).not.toBeNull();
    confirm.mockReturnValue(true);
    await act(async () => session.handleDiscardPendingChapter());
    expect(session.pendingCompletedChapter).toBeNull();
    expect((await storage.getBattleStorySession(originalSession.id))?.sessionSummary).toBe('另一标签更新的摘要');
  });
  it('同步双击以及生成结束后的保存窗口均不可重入', async () => {
    await mount();
    let resolveSave!: () => void;
    const gate = new Promise<void>((resolve) => { resolveSave = resolve; });
    const original = storage.commitCompletedBattleStoryChapter;
    vi.spyOn(storage, 'commitCompletedBattleStoryChapter').mockImplementationOnce(async (commit) => { await gate; return original(commit); });
    let pending!: Promise<void>;
    await act(async () => { pending = session.handleStartSession(); void session.handleStartSession(); });
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    await act(async () => { send(event('markdown', { chunk: '# 首章' }) + event('done', { ok: true })); stream.close(); });
    expect(session.isGenerating).toBe(false); expect(session.isSavingChapter).toBe(true);
    await act(async () => { await session.handleStartSession(); await session.handleBranchSession(); await session.handleRewriteLastChapter(); });
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    await act(async () => { resolveSave(); await pending; });
    expect(session.pendingCompletedChapter).toBeNull();
  });
  it('用户取消不会生成 pending 或任何章节记录', async () => {
    await mount(); const { pending } = await start();
    await act(async () => { send(event('markdown', { chunk: '未完成' })); await Promise.resolve(); session.stopGeneration(); await pending; });
    expect(session.pendingCompletedChapter).toBeNull();
    expect(await storage.listBattleStorySessions()).toHaveLength(0);
  });
  it('首章提交结果不明且另一 tab 已删除：重试零复活，只有明确另存才新建身份且零重模型', async () => {
    await mount();
    const original = storage.commitCompletedBattleStoryChapter;
    vi.spyOn(storage, 'commitCompletedBattleStoryChapter').mockImplementationOnce(async (commit) => { await original(commit); throw new Error('lost receipt'); });
    const { pending } = await start(); await finish(pending, '# 保留首章\n全部正文');
    const oldChapter = session.pendingCompletedChapter!;
    await storage.deleteBattleStorySession(oldChapter.sessionId);
    expect(await storage.getBattleStoryOperationReceipt(oldChapter.id)).toBeNull();
    await act(async () => session.handleRetrySaveChapter());
    expect(await storage.listBattleStorySessions()).toEqual([]);
    expect(session.pendingSaveAsNewSession).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => session.handleSavePendingAsNewSession());
    expect(await storage.listBattleStorySessions()).toEqual([]);
    confirm.mockReturnValue(true);
    await act(async () => session.handleSavePendingAsNewSession());
    expect(session.pendingCompletedChapter).toBeNull();
    expect(session.activeSession!.id).not.toBe(oldChapter.sessionId);
    expect(session.selectedChapter!.id).not.toBe(oldChapter.id);
    expect(session.selectedChapter!.markdown).toBe(oldChapter.markdown);
    expect(session.selectedChapter!.reportJson).toEqual(oldChapter.reportJson);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(await storage.getBattleStorySession(oldChapter.sessionId)).toBeNull();
  });
  it('冻结的是生成前独立输入，不能冻结或污染 arena 草稿', async () => {
    await mount(); const { pending } = await start();
    fixture.state.combatants[0]!.data.codename = '生成途中新改的名字';
    await finish(pending);
    expect(Object.isFrozen(fixture.state.combatants[0]!.data)).toBe(false);
    expect(Object.isFrozen(fixture.state.materials)).toBe(false);
    expect(Object.isFrozen(fixture.state.adjudicationEvents)).toBe(false);
    expect((session.activeSession!.seed.combatants[0] as { data: { codename: string } }).data.codename).toBe('测试角色');
    fixture.state.combatants[0]!.data.codename = '完成后仍可编辑';
    expect((await storage.getBattleStorySession(session.activeSession!.id))!.seed.combatants).toEqual(session.activeSession!.seed.combatants);
  });
  it('保存成功但随后读取失败准确提示并可只重读，不丢失已存章或重模型', async () => {
    const original = storage.listBattleStorySessions;
    let fail = false;
    vi.spyOn(storage, 'listBattleStorySessions').mockImplementation(async (...args) => { if (fail) throw new Error('read failed'); return original(...args); });
    await mount(); const { pending } = await start(); fail = true; await finish(pending);
    expect(await original()).toHaveLength(1);
    expect(session.pendingCompletedChapter).toBeNull();
    expect(session.actionError).toContain('本章已保存');
    expect(session.hasUnreadSavedChapter).toBe(true);
    fail = false;
    await act(async () => session.handleReloadSavedChapter());
    expect(session.selectedChapter?.markdown).toBe('# 完成章\n正文');
    expect(session.hasUnreadSavedChapter).toBe(false);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });
  it('summary 迟到只更新匹配会话，不把用户从第一章跳回最新章', async () => {
    let resolveSummary!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { resolveSummary = resolve; });
    const fetch = vi.fn(() => response); vi.stubGlobal('fetch', fetch);
    await mount(); const first = await start(); await finish(first.pending, '# 第1章');
    const firstChapter = session.selectedChapter!.id;
    for (const index of [2, 3]) {
      let pending!: Promise<void>;
      await act(async () => { pending = session.handleContinueSession(); });
      await finish(pending, `# 第${index}章`);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => session.setSelectedChapterId(firstChapter));
    await act(async () => resolveSummary(new Response(JSON.stringify({ summary: '完整摘要', fallback: true }), { status: 200 })));
    await vi.waitFor(async () => { await act(async () => {}); expect(session.isRefreshingSummary).toBe(false); });
    expect(session.activeSession?.sessionSummary).toBe('完整摘要');
    expect(session.selectedChapter?.id).toBe(firstChapter);
    expect(fixture.dispatch).toHaveBeenCalledTimes(3);
  });
  it('已完成正文的服务端章节位置异常仍可保文导出，不默默重模型', async () => {
    await mount(); const { pending } = await start();
    await act(async () => { send(event('session_meta', { chapterIndex: 9 })); });
    await finish(pending, '# 完整但位置错误\n原文');
    expect(session.pendingCompletedChapter?.markdown).toContain('完整但位置错误');
    expect(await storage.listBattleStorySessions()).toEqual([]);
    await act(async () => session.handleExportPendingChapter());
    expect(fixture.download).toHaveBeenCalledTimes(1);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });

  it('已知 abort 后的本地重试若丢回执，必须升级为未知，不能在删除后再次复活', async () => {
    await mount();
    const original = storage.commitCompletedBattleStoryChapter;
    vi.spyOn(storage, 'commitCompletedBattleStoryChapter')
      .mockRejectedValueOnce(new storage.BattleStoryCommitNotSavedError(new Error('known preflight fault')))
      .mockImplementationOnce(async (commit) => { await original(commit); throw new Error('retry lost receipt'); });
    const { pending } = await start(); await finish(pending);
    const old = session.pendingCompletedChapter!;
    await act(async () => session.handleRetrySaveChapter());
    expect(await storage.getBattleStoryOperationReceipt(old.id)).not.toBeNull();
    await storage.deleteBattleStorySession(old.sessionId);
    await act(async () => session.handleRetrySaveChapter());
    expect(await storage.getBattleStorySession(old.sessionId)).toBeNull();
    expect(session.pendingSaveAsNewSession).toBe(true);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });

  it('receipt mismatch 仅查询冲突，不能把历史 unknown 降回可安全重写', async () => {
    await mount();
    const original = storage.commitCompletedBattleStoryChapter;
    const save = vi.spyOn(storage, 'commitCompletedBattleStoryChapter').mockImplementationOnce(async (commit) => { await original(commit); throw new Error('lost reply'); });
    const { pending } = await start(); await finish(pending);
    const chapter = session.pendingCompletedChapter!;
    const stored = await storage.getBattleStoryChapter(chapter.id);
    const receipt = await storage.getBattleStoryOperationReceipt(chapter.id);
    await storage.putBattleStoryChapter({ ...stored!, ...{ commitReceipt: { ...receipt!, contentDigest: 'mismatched' } } });
    await act(async () => session.handleRetrySaveChapter());
    expect(save).toHaveBeenCalledTimes(1);
    expect(session.pendingSaveUnknown).toBe(true);
    await storage.deleteBattleStorySession(chapter.sessionId);
    await act(async () => session.handleRetrySaveChapter());
    expect(await storage.getBattleStorySession(chapter.sessionId)).toBeNull();
    expect(session.pendingSaveAsNewSession).toBe(true);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });

  it('真实 Panel 的失败保文按钮与禁用生成消费同一 hook 状态', async () => {
    const useOriginal = storyHook.useBattleStorySession;
    vi.spyOn(storyHook, 'useBattleStorySession').mockImplementation(function useObservedSession() {
      const value = useOriginal(); useLayoutEffect(() => { session = value; }); return value;
    });
    await act(async () => root.render(<BattleStorySessionPanel />));
    await vi.waitFor(async () => { await act(async () => {}); expect(session.isReady).toBe(true); });
    vi.spyOn(storage, 'commitCompletedBattleStoryChapter').mockRejectedValueOnce(new storage.BattleStoryCommitNotSavedError(new Error('known fault')));
    const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === text)!;
    const { pending } = await start(); await finish(pending, '# UI待保存章\n正文');
    expect(container.textContent).toContain('生成完成，本章尚未保存');
    expect(button('新建连续战报').disabled).toBe(true);
    expect(button('重试保存').disabled).toBe(false);
    await act(async () => button('导出本章').click()); expect(fixture.download).toHaveBeenCalledTimes(1);
    await act(async () => button('重试保存').click());
    await vi.waitFor(async () => { await act(async () => {}); expect(session.pendingCompletedChapter).toBeNull(); });
    expect(container.textContent).not.toContain('生成完成，本章尚未保存');
    expect(container.textContent).toContain('UI待保存章');
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });

});
