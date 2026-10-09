// @vitest-environment jsdom

import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBattleStorySession } from '@/components/arena/hooks/useBattleStorySession';
import * as storage from '@/lib/ai-session/battle-story/storage';
import type { BattleStoryChapterRecord, BattleStorySessionRecord } from '@/lib/ai-session/battle-story/types';

const fixture = vi.hoisted(() => ({
  sessions: new Map<string, BattleStorySessionRecord>(),
  chapters: new Map<string, BattleStoryChapterRecord>(),
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
    listBattleStorySessions: async () => [...fixture.sessions.values()],
    getBattleStorySession: async (id: string) => fixture.sessions.get(id) ?? null,
    listBattleStoryChaptersBySession: async (id: string) => [...fixture.chapters.values()].filter((item) => item.sessionId === id),
    listBattleStoryCheckpointsBySession: async () => [],
    putBattleStorySession: async (item: BattleStorySessionRecord) => { fixture.sessions.set(item.id, item); },
    putBattleStoryChapter: async (item: BattleStoryChapterRecord) => { fixture.chapters.set(item.id, item); },
    putBattleStoryCheckpoints: async () => {},
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

function addHistory() {
  const record = storage.createBattleStorySessionRecord({
    title: '历史会话', source: { mode: 'daily', language: 'zh-CN', storyLength: 'standard', generationMode: 'stream' },
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
  fixture.sessions.clear(); fixture.chapters.clear(); fixture.dispatch.mockReset();
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
