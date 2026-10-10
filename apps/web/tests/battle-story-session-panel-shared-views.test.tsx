// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleStorySessionPanel } from '@/components/arena/components/BattleStorySessionPanel';
import type { useBattleStorySession } from '@/components/arena/hooks/useBattleStorySession';
import type { BattleStoryChapterRecord, BattleStorySessionRecord } from '@/lib/ai-session/battle-story/types';

const fixture = vi.hoisted(() => ({ hook: {} as Partial<ReturnType<typeof useBattleStorySession>>, card: vi.fn(), download: vi.fn() }));
vi.mock('@/components/arena/hooks/useBattleStorySession', () => ({ useBattleStorySession: () => fixture.hook }));
vi.mock('@/components/arena/stores/useBattleStore', () => ({ useBattleStore: (selector: (value: unknown) => unknown) => selector({ settings: { battleReportCardWidthMode: 'manual', battleReportCardWidthPx: 760 } }) }));
vi.mock('@/components/shared/CollapsibleSection', () => ({ CollapsibleSection: ({ children }: { children: ReactNode }) => <section>{children}</section> }));
vi.mock('@/components/ai/ProviderCooldownNotice', () => ({ ProviderCooldownNotice: () => <span>宿主冷却提示</span> }));
vi.mock('@/components/shared/battle-report-ports', () => ({ createWebBattleReportPorts: () => ({ downloadMarkdown: fixture.download }) }));
vi.mock('@/components/MarkdownBlock', () => ({ MarkdownBlock: ({ content }: { content: string }) => <pre>{content}</pre> }));
vi.mock('@/components/shared/StreamStopButton', () => ({ StreamStopButton: ({ onClick, label }: { onClick(): void; label: string }) => <button onClick={onClick}>{label}</button> }));
vi.mock('@/components/stream/StreamingBattleReportCard', () => ({ default: (props: Record<string, unknown>) => {
  fixture.card(props); return <article data-report-card>{String(props.content)}</article>;
} }));
vi.mock('@/components/arena/components/BattleStoryBranchChainModal', () => ({ BattleStoryBranchChainModal: () => null }));

let root: Root;
let container: HTMLDivElement;
let chapters: BattleStoryChapterRecord[];
let session: BattleStorySessionRecord;
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
const render = async () => { await act(async () => root.render(<BattleStorySessionPanel />)); };

beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  chapters = [1, 2].map((index) => ({
    id: `chapter-${index}`, sessionId: 'session-A', index, action: index === 1 ? 'start' : 'continue', status: 'active',
    title: `章节${index}`, markdown: `完整正文${index}`, reportJson: {}, createdAt: 1_700_000_000_000,
    deterministicDigest: { chapterTitle: `章节${index}`, winner: '测试角色' },
    cardSnapshot: { userGuidance: `章节引导${index}`, reporterInfo: { name: '记录员', publication: '日报' }, aiModel: 'frozen-model', narrativeHistoryReadCount: 4 },
  }));
  session = {
    id: 'session-A', title: '会话 A', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001,
    source: { mode: 'daily', language: 'zh-CN', storyLength: 'standard', generationMode: 'stream' },
    seed: { combatants: [], settings: { readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false, readNarrativeHistory: false, writeNarrativeHistory: false } },
    workingCombatants: [], chapterCount: 2, lastChapterId: chapters[1]!.id,
  };
  fixture.hook = {
    isReady: true, sessions: [session], activeSession: session, chapters, latestActiveChapter: chapters[1],
    selectedChapter: chapters[0], selectedChapterId: chapters[0]!.id, selectedChapterIsLatest: false,
    streamingMarkdown: '', isGenerating: false, isCooldown: false, canStartFromArena: true,
    activeChapterProgressText: '2 章', draftChapterPlanMode: 'none', draftChapterPlanInput: '',
    setSelectedChapterId: vi.fn(), handleSelectSession: vi.fn(), handleBranchSelectedChapter: vi.fn(),
    handleRewriteSelectedChapter: vi.fn(), handleDeleteSelectedChapter: vi.fn(), handleStartSession: vi.fn(),
    handleContinueSession: vi.fn(), handleBranchSession: vi.fn(), handleRewriteLastChapter: vi.fn(),
    handleExportMarkdown: vi.fn(), handleDeleteSession: vi.fn(), stopGeneration: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Web panel consumes the shared controlled story views', () => {
  it('keeps a selected older chapter and original card snapshot across list refresh and rerenders', async () => {
    await render();
    const reader = () => container.querySelector('[data-story-read-status="loaded"]')!;
    expect(reader().getAttribute('data-story-chapter-id')).toBe('chapter-1');
    expect(reader().textContent).toContain('章节预览｜第 1 章 · 章节1');
    expect(reader().textContent).toContain('完整正文1');
    expect(fixture.card).toHaveBeenLastCalledWith(expect.objectContaining({
      content: '完整正文1', userGuidance: '章节引导1', reporterInfo: { name: '记录员', publication: '日报' },
      aiModel: 'frozen-model', narrativeHistoryReadCount: 4, cardWidthPx: 760,
    }));
    fixture.hook.sessions = [{ ...session, updatedAt: session.updatedAt + 10 }]; fixture.hook.chapters = [...chapters]; await render();
    expect(reader().getAttribute('data-story-chapter-id')).toBe('chapter-1');
    expect(fixture.hook.setSelectedChapterId).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
    const secondRow = [...container.querySelectorAll('button[aria-pressed]')].find((item) => item.textContent?.startsWith('第 2 章')) as HTMLButtonElement;
    await act(async () => secondRow.click());
    expect(fixture.hook.setSelectedChapterId).toHaveBeenCalledExactlyOnceWith('chapter-2');
    expect(reader().getAttribute('data-story-chapter-id')).toBe('chapter-1');
    const sessionRow = container.querySelector('button[aria-pressed="true"]') as HTMLButtonElement;
    await act(async () => sessionRow.click()); expect(fixture.hook.handleSelectSession).toHaveBeenCalledExactlyOnceWith('session-A');
  });

  it('retains host branch/rewrite/delete actions, cooldown blocks and Markdown export', async () => {
    await render();
    await act(async () => {
      button('从第 1 章创建分支').click(); button('重写本章并截断后续').click(); button('删除整个会话').click(); button('导出 Markdown').click();
    });
    expect(fixture.hook.handleBranchSelectedChapter).toHaveBeenCalledTimes(1);
    expect(fixture.hook.handleRewriteSelectedChapter).toHaveBeenCalledTimes(1);
    expect(fixture.hook.handleDeleteSelectedChapter).toHaveBeenCalledTimes(1);
    expect(fixture.hook.handleExportMarkdown).toHaveBeenCalledTimes(1);
    fixture.hook.isCooldown = true; fixture.hook.remainingTime = 9; await render();
    const cooldownButtons = [...container.querySelectorAll('button')].filter((item) => item.textContent === '冷却中 9s');
    expect(cooldownButtons.length).toBeGreaterThan(0); expect(cooldownButtons.every((item) => item.disabled)).toBe(true);
    expect(button('导出 Markdown').disabled).toBe(false); expect(container.textContent).toContain('宿主冷却提示');
  });

  it('preserves live host card rendering and stop while the shared reader retains the committed selection', async () => {
    fixture.hook.isGenerating = true; fixture.hook.generatingAction = 'continue'; fixture.hook.streamChapterIndex = 3;
    fixture.hook.streamingMarkdown = '尚未提交的第三章'; fixture.hook.streamCardSnapshot = { userGuidance: '本次输入' }; await render();
    expect(container.querySelectorAll('[data-report-card]')).toHaveLength(2);
    expect(fixture.card).toHaveBeenCalledWith(expect.objectContaining({ content: '尚未提交的第三章', userGuidance: '本次输入', isStreaming: true }));
    expect(container.querySelector('[data-story-chapter-id]')?.textContent).toContain('完整正文1');
    await act(async () => button('停止生成').click()); expect(fixture.hook.stopGeneration).toHaveBeenCalledTimes(1);
  });

  it('keeps large saved and pending bodies unmounted, shortens title DOM, and exports the untouched record', async () => {
    const originalTitle = '超长标题'.repeat(80_000) + '标题尾部';
    const originalBody = '# ' + originalTitle + '\n\n完整正文尾部';
    chapters[0]!.title = originalTitle; chapters[0]!.markdown = originalBody;
    session.title = originalTitle; fixture.hook.pendingCompletedChapter = chapters[0];
    fixture.hook.handleExportPendingChapter = vi.fn();
    fixture.hook.handleExportMarkdown = vi.fn(() => {
      expect(fixture.hook.selectedChapter?.markdown).toBe(originalBody);
      expect(fixture.hook.activeSession?.title).toBe(originalTitle);
    });
    await render();
    expect(fixture.card).not.toHaveBeenCalled();
    expect(container.textContent!.length).toBeLessThan(6000);
    expect(container.textContent).toContain('标题已缩短');
    expect(container.textContent).not.toContain('标题尾部');
    expect([...container.querySelectorAll('[title]')].every((element) => (element.getAttribute('title')?.length ?? 0) < 500)).toBe(true);
    await act(async () => button('导出 Markdown').click());
    expect(fixture.hook.handleExportMarkdown).toHaveBeenCalledTimes(1);
    const preview = container.querySelector('[data-story-read-status="loaded"]')!;
    await act(async () => (preview.querySelector('[data-story-content-preview] button') as HTMLButtonElement).click());
    expect(fixture.card).toHaveBeenLastCalledWith(expect.objectContaining({ content: originalBody }));
    expect(preview.querySelector('[data-report-card]')?.textContent).toBe(originalBody);
    await act(async () => (preview.querySelector('[data-story-content-preview] button') as HTMLButtonElement).click());
    expect(preview.querySelector('[data-report-card]')).toBeNull();
    expect(chapters[0]!.title).toBe(originalTitle); expect(chapters[0]!.markdown).toBe(originalBody);
  });

  it('guards the actual live card at the threshold while keeping stop and saved selection available', async () => {
    const liveBody = '文'.repeat(256 * 1024 + 1);
    fixture.hook.isGenerating = true; fixture.hook.generatingAction = 'continue';
    fixture.hook.streamChapterIndex = 3; fixture.hook.streamingMarkdown = liveBody;
    await render();
    expect(fixture.card).toHaveBeenCalledTimes(1);
    expect(fixture.card).toHaveBeenCalledWith(expect.objectContaining({ content: '完整正文1' }));
    expect(container.textContent).toContain('正文完整保留');
    await act(async () => button('导出当前正文').click());
    expect(fixture.download).toHaveBeenCalledExactlyOnceWith(liveBody, '连续战报_第3章_当前正文.md');
    expect(fixture.card).toHaveBeenCalledTimes(1);
    await act(async () => button('展开全文').click());
    expect(fixture.card).toHaveBeenCalledWith(expect.objectContaining({ content: liveBody, isStreaming: true }));
    await act(async () => button('停止生成').click()); expect(fixture.hook.stopGeneration).toHaveBeenCalledTimes(1);
    expect(fixture.hook.streamingMarkdown).toBe(liveBody);
  });


  it.each(['saved', 'pending', 'existing-adjudication'] as const)('exports the complete collapsed %s chapter with the established adjudication rules, without mounting its renderer', async (state) => {
    const body = '# 保留原章\n\n' + '正文'.repeat(140_000) + '\n末尾原文';
    const existing = state === 'existing-adjudication';
    const markdown = existing ? body + '\n\n## 随机判定记录\n原有判定' : body;
    chapters[0]!.markdown = markdown;
    chapters[0]!.cardSnapshot = { adjudicationResults: [{
      depth: 0, type: 'binary', description: '  通过大门  ', roll: 7, outcome: ' 成功 ', details: ' 投掷7 ',
    }] };
    if (state === 'pending') fixture.hook.pendingCompletedChapter = chapters[0];
    await render();
    expect(fixture.card).not.toHaveBeenCalled();
    const preview = state === 'pending'
      ? container.querySelector('details [data-story-content-preview]')!
      : container.querySelector('[data-story-read-status="loaded"] [data-story-content-preview]')!;
    const exportButton = [...preview.querySelectorAll('button')].find((item) => item.textContent === '导出本章')!;
    await act(async () => exportButton.click());
    const expected = existing ? markdown : markdown + '\n\n---\n\n## 随机判定记录\n- **事件**: 通过大门\n  - **结果**: 成功 (投掷7)';
    expect(fixture.download).toHaveBeenCalledExactlyOnceWith(expected, '连续战报_第1章.md');
    expect(fixture.card).not.toHaveBeenCalled();
    expect(fixture.hook.handleExportMarkdown).not.toHaveBeenCalled();
    expect(chapters[0]!.markdown).toBe(markdown);
  });

});
